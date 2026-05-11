/**
 * Plugin System — auto-discovery and lifecycle management for
 * @skeleton-plugin-* npm packages and local .skeleton/plugins/ directories.
 *
 * Plugins can:
 * - Register tools into the ToolRegistry
 * - Register hooks into the HookRegistry
 * - Register providers into the ProviderRegistry
 * - Register slash commands dispatched through processCommandAsync
 * - Register tool-result transformers (rewrite output before messages store)
 * - Register terminal-output transformers (specialized transform for terminal)
 * - Dispatch tools directly (call other registered tools)
 * - Provide skills
 * - Run init/destroy lifecycle callbacks
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ToolRegistry } from "./tools/registry.js";
import type { HookRegistry, HookEvent, HookHandler } from "./hooks.js";

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  hooks?: Record<string, string[]>;
  tools?: string[];
  skills?: string[];
  init?: string;
  destroy?: string;
}

/** Slash command handler registered by plugins */
export type PluginCommandHandler = (args: string, context: PluginContext) => Promise<string> | string;

/** Tool result transformer — can rewrite a tool's output before it lands in messages */
export type ToolResultTransformer = (
  toolName: string,
  args: Record<string, unknown>,
  result: string,
) => Promise<string | null> | string | null;

export interface PluginContext {
  pluginDir: string;
  manifest: PluginManifest;
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
  registerTool: (name: string, description: string, fn: (args: Record<string, unknown>) => Promise<unknown>) => void;
  registerHook: (event: HookEvent, handler: HookHandler) => void;
  registerProvider: (profile: {
    name: string;
    aliases?: string[];
    apiMode: string;
    baseUrl: string;
    apiKeyEnvVars: string[];
    defaultModel: string;
    quirks?: Record<string, unknown>;
  }) => void;
  /** Register a slash command — becomes available as `/<plugin>.<cmd>` */
  registerCommand: (name: string, description: string, handler: PluginCommandHandler) => void;
  /** Register a tool-result transformer — filters/rewrites output of specified tools (or all if no filter) */
  registerToolResultTransformer: (transformer: ToolResultTransformer, options?: { toolNames?: string[] }) => void;
  /** Register a terminal-output transformer — specialized transform for terminal tool stdout */
  registerTerminalOutputTransformer: (transformer: (output: string) => Promise<string | null> | string | null) => void;
  /** Dispatch a tool directly — useful for composing tools within plugin logic */
  dispatchTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
  dataPath: (filename: string) => string;
}

export interface RegisteredPluginCommand {
  pluginName: string;
  name: string;
  description: string;
  fullName: string; // e.g. "myplugin.foo"
  handler: PluginCommandHandler;
  context: PluginContext;
}

interface RegisteredTransformer {
  pluginName: string;
  transformer: ToolResultTransformer;
  toolFilter: Set<string> | null;
}

type LoadedPlugin = {
  manifest: PluginManifest;
  context: PluginContext;
  dir: string;
  registeredTools: string[];
  registeredHooks: Array<{ event: HookEvent; name: string }>;
  registeredCommands: string[];
  registeredTransformers: ToolResultTransformer[];
  registeredTerminalTransformers: Array<(o: string) => Promise<string | null> | string | null>;
};

export class PluginSystem {
  private plugins = new Map<string, LoadedPlugin>();
  private pluginDir: string;
  private nodeModulesDir: string;
  private toolRegistry: ToolRegistry | null = null;
  private hookRegistry: HookRegistry | null = null;

  /** Plugin-registered slash commands (indexed by fullName) */
  private commands = new Map<string, RegisteredPluginCommand>();
  /** Plugin-registered tool-result transformers (applied in registration order) */
  private toolResultTransformers: RegisteredTransformer[] = [];
  /** Plugin-registered terminal-output transformers */
  private terminalTransformers: Array<{ pluginName: string; transformer: (o: string) => Promise<string | null> | string | null }> = [];

  constructor(opts?: { pluginDir?: string; nodeModulesDir?: string }) {
    this.pluginDir = opts?.pluginDir ?? path.join(os.homedir(), ".skeleton", "plugins");
    this.nodeModulesDir = opts?.nodeModulesDir ?? path.join(process.cwd(), "node_modules");
  }

  injectRegistries(tools: ToolRegistry, hooks: HookRegistry): void {
    this.toolRegistry = tools;
    this.hookRegistry = hooks;
  }

  /** List all plugin-registered slash commands (for CLI autocomplete / help) */
  listCommands(): RegisteredPluginCommand[] {
    return [...this.commands.values()];
  }

  /** Resolve a slash command by name (supports `plugin.cmd` full name or bare `cmd` if unambiguous) */
  resolveCommand(name: string): RegisteredPluginCommand | null {
    const direct = this.commands.get(name);
    if (direct) return direct;
    // Try bare name match
    const matches = [...this.commands.values()].filter(c => c.name === name);
    if (matches.length === 1) return matches[0];
    return null;
  }

  /** Apply all registered tool-result transformers in sequence */
  async applyToolResultTransformers(toolName: string, args: Record<string, unknown>, result: string): Promise<string> {
    let current = result;
    for (const reg of this.toolResultTransformers) {
      if (reg.toolFilter && !reg.toolFilter.has(toolName)) continue;
      try {
        const transformed = await reg.transformer(toolName, args, current);
        if (transformed != null) current = transformed;
      } catch (err) {
        console.warn(`Transformer from plugin "${reg.pluginName}" failed: ${(err as Error).message}`);
      }
    }
    return current;
  }

  /** Apply all terminal-output transformers in sequence */
  async applyTerminalTransformers(output: string): Promise<string> {
    let current = output;
    for (const reg of this.terminalTransformers) {
      try {
        const transformed = await reg.transformer(current);
        if (transformed != null) current = transformed;
      } catch (err) {
        console.warn(`Terminal transformer from plugin "${reg.pluginName}" failed: ${(err as Error).message}`);
      }
    }
    return current;
  }

  discover(): string[] {
    const results: string[] = [];

    const scopeDir = path.join(this.nodeModulesDir, "@skeleton-plugin");
    if (fs.existsSync(scopeDir)) {
      const dirs = fs.readdirSync(scopeDir, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory()) {
          const manifestPath = path.join(scopeDir, d.name, "skeleton-plugin.json");
          if (fs.existsSync(manifestPath)) {
            results.push(manifestPath);
          }
        }
      }
    }

    if (fs.existsSync(this.pluginDir)) {
      const entries = fs.readdirSync(this.pluginDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) {
          const manifestPath = path.join(this.pluginDir, e.name, "skeleton-plugin.json");
          if (fs.existsSync(manifestPath)) {
            results.push(manifestPath);
          }
        }
      }
    }

    return results;
  }

  async loadPlugin(dir: string): Promise<PluginManifest> {
    const manifestPath = path.join(dir, "skeleton-plugin.json");
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const manifest: PluginManifest = JSON.parse(raw);

    if (!manifest.name || !manifest.version) {
      throw new Error(`Invalid plugin manifest in ${dir}: missing name or version`);
    }

    if (this.plugins.has(manifest.name)) {
      throw new Error(`Plugin "${manifest.name}" already loaded`);
    }

    const pluginDataDir = path.join(os.homedir(), ".skeleton", "plugin-data", manifest.name);

    const registeredTools: string[] = [];
    const registeredHooks: Array<{ event: HookEvent; name: string }> = [];
    const registeredCommands: string[] = [];
    const registeredTransformers: ToolResultTransformer[] = [];
    const registeredTerminalTransformers: Array<(o: string) => Promise<string | null> | string | null> = [];

    // Capture for closure reference; updated after plugin entry set
    const getSelf = () => this.plugins.get(manifest.name);

    const context: PluginContext = {
      pluginDir: dir,
      manifest,
      logger: {
        info: (msg: string) => console.log(`[plugin:${manifest.name}] ${msg}`),
        warn: (msg: string) => console.warn(`[plugin:${manifest.name}] ${msg}`),
        error: (msg: string) => console.error(`[plugin:${manifest.name}] ${msg}`),
      },
      registerTool: (name, description, fn) => {
        if (!this.toolRegistry) {
          context.logger.warn(`Tool registry not available — cannot register tool "${name}"`);
          return;
        }
        const fullName = `plugin_${manifest.name}_${name}`;
        this.toolRegistry.register({
          name: fullName,
          description: `[${manifest.name}] ${description}`,
          parameters: {
            type: "object",
            properties: {
              input: { type: "string", description: "Input for the tool" },
            },
            required: [],
          },
          execute: fn,
        });
        registeredTools.push(fullName);
        context.logger.info(`Registered tool: ${fullName}`);
      },
      registerHook: (event, handler) => {
        if (!this.hookRegistry) {
          context.logger.warn(`Hook registry not available — cannot register hook for "${event}"`);
          return;
        }
        const hookName = `plugin:${manifest.name}:${event}`;
        this.hookRegistry.register(event, handler, hookName);
        registeredHooks.push({ event, name: hookName });
        context.logger.info(`Registered hook: ${event} (${hookName})`);
      },
      registerProvider: (profile) => {
        try {
          const { registerProvider: regProv } = require("./providers/registry.js") as typeof import("./providers/registry.js");
          regProv(profile as any);
          context.logger.info(`Registered provider: ${profile.name}`);
        } catch (err) {
          context.logger.warn(`Failed to register provider "${profile.name}": ${(err as Error).message}`);
        }
      },
      registerCommand: (name, description, handler) => {
        const fullName = `${manifest.name}.${name}`;
        if (this.commands.has(fullName)) {
          context.logger.warn(`Command "${fullName}" already registered — overriding`);
        }
        this.commands.set(fullName, {
          pluginName: manifest.name,
          name,
          description,
          fullName,
          handler,
          context,
        });
        registeredCommands.push(fullName);
        context.logger.info(`Registered command: /${fullName}`);
      },
      registerToolResultTransformer: (transformer, options) => {
        const toolFilter = options?.toolNames ? new Set(options.toolNames) : null;
        this.toolResultTransformers.push({
          pluginName: manifest.name,
          transformer,
          toolFilter,
        });
        registeredTransformers.push(transformer);
        const label = toolFilter ? [...toolFilter].join(",") : "all tools";
        context.logger.info(`Registered tool-result transformer for: ${label}`);
      },
      registerTerminalOutputTransformer: (transformer) => {
        this.terminalTransformers.push({ pluginName: manifest.name, transformer });
        registeredTerminalTransformers.push(transformer);
        context.logger.info(`Registered terminal-output transformer`);
      },
      dispatchTool: async (name, args) => {
        if (!this.toolRegistry) {
          throw new Error("Tool registry not available");
        }
        return this.toolRegistry.execute(name, args);
      },
      dataPath: (filename) => {
        fs.mkdirSync(pluginDataDir, { recursive: true });
        return path.join(pluginDataDir, filename);
      },
    };

    this.plugins.set(manifest.name, {
      manifest,
      context,
      dir,
      registeredTools,
      registeredHooks,
      registeredCommands,
      registeredTransformers,
      registeredTerminalTransformers,
    });

    if (manifest.init) {
      try {
        const initPath = path.join(dir, manifest.init);
        if (fs.existsSync(initPath)) {
          const initFn = await importInitScript(initPath);
          if (typeof initFn === "function") {
            await initFn(context);
            context.logger.info("Init script executed");
          }
        }
      } catch (err) {
        context.logger.error(`Init script failed: ${(err as Error).message}`);
      }
    }

    return manifest;
  }

  async unloadPlugin(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    if (plugin.manifest.destroy) {
      try {
        const destroyPath = path.join(plugin.dir, plugin.manifest.destroy);
        if (fs.existsSync(destroyPath)) {
          const destroyFn = await importInitScript(destroyPath);
          if (typeof destroyFn === "function") {
            await destroyFn(plugin.context);
          }
        }
      } catch (err) {
        plugin.context.logger.error(`Destroy script failed: ${(err as Error).message}`);
      }
    }

    for (const toolName of plugin.registeredTools) {
      this.toolRegistry?.unregister(toolName);
    }
    for (const hook of plugin.registeredHooks) {
      this.hookRegistry?.unregister(hook.name);
    }
    for (const cmdName of plugin.registeredCommands) {
      this.commands.delete(cmdName);
    }
    this.toolResultTransformers = this.toolResultTransformers.filter(
      (r) => !plugin.registeredTransformers.includes(r.transformer),
    );
    this.terminalTransformers = this.terminalTransformers.filter(
      (r) => !plugin.registeredTerminalTransformers.includes(r.transformer),
    );

    this.plugins.delete(name);
    return true;
  }

  async loadAll(): Promise<PluginManifest[]> {
    const manifests = this.discover();
    const loaded: PluginManifest[] = [];
    for (const mp of manifests) {
      const dir = path.dirname(mp);
      try {
        loaded.push(await this.loadPlugin(dir));
      } catch (err) {
        console.warn(`Failed to load plugin from ${dir}: ${(err as Error).message}`);
      }
    }
    return loaded;
  }

  getPlugin(name: string): PluginContext | undefined {
    return this.plugins.get(name)?.context;
  }

  listLoaded(): PluginManifest[] {
    return [...this.plugins.values()].map((p) => p.manifest);
  }

  async reloadPlugin(name: string): Promise<PluginManifest | null> {
    const plugin = this.plugins.get(name);
    if (!plugin) return null;
    const dir = plugin.dir;
    await this.unloadPlugin(name);
    return this.loadPlugin(dir);
  }
}

async function importInitScript(filePath: string): Promise<unknown> {
  try {
    const mod = await import(`file://${filePath}`);
    return mod.default ?? mod;
  } catch {
    try {
      const mod = require(filePath);
      return mod.default ?? mod;
    } catch {
      return null;
    }
  }
}
