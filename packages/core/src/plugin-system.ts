/**
 * Plugin System — auto-discovery and lifecycle management for
 * @skeleton-plugin-* npm packages and local .skeleton/plugins/ directories.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface PluginManifest {
  name: string;
  version: string;
  hooks?: Record<string, string[]>;
  tools?: string[];
  skills?: string[];
}

export interface PluginContext {
  pluginDir: string;
  manifest: PluginManifest;
  logger: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
}

type LoadedPlugin = {
  manifest: PluginManifest;
  context: PluginContext;
  dir: string;
};

export class PluginSystem {
  private plugins = new Map<string, LoadedPlugin>();
  private pluginDir: string;
  private nodeModulesDir: string;

  constructor(opts?: { pluginDir?: string; nodeModulesDir?: string }) {
    this.pluginDir = opts?.pluginDir ?? path.join(os.homedir(), ".skeleton", "plugins");
    this.nodeModulesDir = opts?.nodeModulesDir ?? path.join(process.cwd(), "node_modules");
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

    const context: PluginContext = {
      pluginDir: dir,
      manifest,
      logger: {
        info: (msg: string) => console.log(`[plugin:${manifest.name}] ${msg}`),
        warn: (msg: string) => console.warn(`[plugin:${manifest.name}] ${msg}`),
        error: (msg: string) => console.error(`[plugin:${manifest.name}] ${msg}`),
      },
    };

    this.plugins.set(manifest.name, { manifest, context, dir });
    return manifest;
  }

  /** Unload a previously loaded plugin by name */
  async unloadPlugin(name: string): Promise<boolean> {
    return this.plugins.delete(name);
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
}
