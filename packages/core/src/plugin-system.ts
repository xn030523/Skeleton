/**
 * Plugin System — auto-discovery and lifecycle management for
 * @skeleton-plugin-* npm packages and local .skeleton/plugins/ directories.
 *
 * Plugins can:
 * - Register tools into the ToolRegistry
 * - Register hooks into the HookRegistry
 * - Provide skills
 * - Run init/destroy lifecycle callbacks
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ToolRegistry } from "./tools/registry.js";
import type { HookRegistry, HookEvent, HookHandler } from "./hooks.js";
import type { SkillDef } from "./skills/registry.js";

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  /** Hook event → handler function path (relative to plugin dir) */
  hooks?: Record<string, string[]>;
  /** Tool function paths (relative to plugin dir) */
  tools?: string[];
  /** Skill names this plugin provides */
  skills?: string[];
  /** Init script path (runs on load) */
  init?: string;
  /** Destroy script path (runs on unload) */
  destroy?: string;
}

export interface PluginContext {
  pluginDir: string;
  manifest: PluginManifest;
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
  /** Register a tool from this plugin */
  registerTool: (name: string, description: string, fn: (args: Record<string, unknown>) => Promise<unknown>) => void;
  /** Register a hook from this plugin */
  registerHook: (event: HookEvent, handler: HookHandler) => void;
  /** Get a plugin-scoped data path for persistent storage */
  dataPath: (filename: string) => string;
}

type LoadedPlugin = {
  manifest: PluginManifest;
  context: PluginContext;
  dir: string;
  registeredTools: string[];
  registeredHooks: Array<{ event: HookEvent; name: string }>;
};

export class PluginSystem {
  private plugins = new Map<string, LoadedPlugin>();
  private pluginDir: string;
  private nodeModulesDir: string;
  private toolRegistry: ToolRegistry | null = null;
  private hookRegistry: HookRegistry | null = null;

  constructor(opts?: { pluginDir?: string; nodeModulesDir?: string }) {
    this.pluginDir = opts?.pluginDir ?? path.join(os.homedir(), ".skeleton", "plugins");
    this.nodeModulesDir = opts?.nodeModulesDir ?? path.join(process.cwd(), "node_modules");
  }

  /** Inject the tool and hook registries for plugin registration */
  injectRegistries(tools: ToolRegistry, hooks: HookRegistry): void {
    this.toolRegistry = tools;
    this.hookRegistry = hooks;
  }

  /** Scan both discovery sources and return discovered manifest paths */
  discover(): string[] {
    const results: string[] = [];

    // Scan node_modules/@skeleton-plugin-*
    if (fs.existsSync(this.nodeModulesDir)) {
      const dirs = fs.readdirSync(this.nodeModulesDir, { withFileTypes: true });
      for (const d of dirs) {
        if (d.isDirectory() && d.name.startsWith("@skeleton-plugin-")) {
          const pkgDir = path.join(this.nodeModulesDir, d.name);
          const manifestPath = path.join(pkgDir, "skeleton-plugin.json");
          if (fs.existsSync(manifestPath)) {
            results.push(manifestPath);
          }
        }
      }
    }

    // Scan .skeleton/plugins/
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

  /** Load a plugin from a directory containing skeleton-plugin.json */
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
      dataPath: (filename) => {
        fs.mkdirSync(pluginDataDir, { recursive: true });
        return path.join(pluginDataDir, filename);
      },
    };

    this.plugins.set(manifest.name, { manifest, context, dir, registeredTools, registeredHooks });

    // Run init script if specified
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

  /** Unload a previously loaded plugin by name — removes tools and hooks */
  async unloadPlugin(name: string): Promise<boolean> {
    const plugin = this.plugins.get(name);
    if (!plugin) return false;

    // Run destroy script if specified
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

    // Unregister tools
    for (const toolName of plugin.registeredTools) {
      this.toolRegistry?.unregister(toolName);
    }

    // Unregister hooks
    for (const hook of plugin.registeredHooks) {
      this.hookRegistry?.unregister(hook.name);
    }

    this.plugins.delete(name);
    return true;
  }

  /** Load all discovered plugins */
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

  /** Get a loaded plugin's context */
  getPlugin(name: string): PluginContext | undefined {
    return this.plugins.get(name)?.context;
  }

  /** List all loaded plugin manifests */
  listLoaded(): PluginManifest[] {
    return [...this.plugins.values()].map((p) => p.manifest);
  }

  /** Reload a plugin (unload + load) */
  async reloadPlugin(name: string): Promise<PluginManifest | null> {
    const plugin = this.plugins.get(name);
    if (!plugin) return null;
    const dir = plugin.dir;
    await this.unloadPlugin(name);
    return this.loadPlugin(dir);
  }
}

async function importInitScript(filePath: string): Promise<unknown> {
  // Try dynamic import for ESM, fall back to require for CJS
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
