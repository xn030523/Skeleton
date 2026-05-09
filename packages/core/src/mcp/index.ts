import type { McpServerConfig } from "../config/index.js";
import { BUILTIN_MCP_SERVERS } from "./servers.js";
import { MCP_CATEGORIES } from "./types.js";
import type { BuiltinMcpServer, McpCategory } from "./types.js";
import { isCommandAvailable } from "./resolve.js";

export type { BuiltinMcpServer, McpCategory } from "./types.js";
export { MCP_CATEGORIES } from "./types.js";
export { mcpManageTool } from "./tools.js";
export { SkeletonMcpHost } from "./host.js";
export { resolveCommand, isCommandAvailable, checkCommandAvailability } from "./resolve.js";

/**
 * Build merged MCP servers config.
 *
 * Built-in servers are OFF by default. They activate when:
 *   1. User lists the server name in skeleton.yaml → mcp.servers.<name>
 *      (user config takes priority, enables + allows override)
 *   2. User sets the server's envEnable variable to "true"
 *      (e.g., SKELETON_MCP_GHIDRA=true)
 *
 * Checks:
 *   - Platform compatibility (skip if server.platform doesn't include process.platform)
 *   - Required env vars (warn + skip if missing)
 */
export function buildMcpServersConfig(
  userServers?: Record<string, McpServerConfig>,
): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = {};

  // User-defined servers: always included, auto-enables matching built-in
  if (userServers) {
    for (const [name, config] of Object.entries(userServers)) {
      servers[name] = config;
    }
  }

  // Built-in servers: only activate when explicitly enabled
  for (const builtin of BUILTIN_MCP_SERVERS) {
    // If user already defined this name, their config wins
    if (servers[builtin.name]) continue;

    // Platform check
    if (builtin.platform && !builtin.platform.includes(process.platform)) {
      continue;
    }

    // Check explicit enable via env var
    const envVal = (process.env[builtin.envEnable] ?? "").toLowerCase();
    if (envVal !== "true") continue;

    // Required env vars must be present
    if (builtin.requiredEnv) {
      const missing = builtin.requiredEnv.filter((v) => !process.env[v]);
      if (missing.length > 0) {
        console.warn(
          `  MCP "${builtin.name}" enabled but missing required env: ${missing.join(", ")}. Skipping.`,
        );
        continue;
      }
    }

    // Command must exist on the system (Hermes-style shutil.which() check)
    if (builtin.config.command && !isCommandAvailable(builtin.config.command)) {
      console.warn(
        `  MCP "${builtin.name}" enabled but command "${builtin.config.command}" not found. Skipping. Install the required tool or remove SKELETON_MCP_${builtin.name.replace(/-/g, "_").toUpperCase()}=true.`,
      );
      continue;
    }

    servers[builtin.name] = builtin.config;
  }

  return servers;
}

/** List all built-in MCP server definitions (for display/metadata) */
export function listBuiltinMcpServers(): BuiltinMcpServer[] {
  return [...BUILTIN_MCP_SERVERS];
}

/** List built-in servers grouped by category */
export function listBuiltinMcpServersByCategory(): Record<string, BuiltinMcpServer[]> {
  const groups: Record<string, BuiltinMcpServer[]> = {};
  for (const server of BUILTIN_MCP_SERVERS) {
    const label = MCP_CATEGORIES[server.category] ?? server.category;
    if (!groups[label]) groups[label] = [];
    groups[label].push(server);
  }
  return groups;
}

/** Generate a help text listing all built-in MCP servers and how to enable them */
export function generateMcpHelpText(): string {
  const lines: string[] = ["Built-in MCP servers (all disabled by default):", ""];

  const byCategory = listBuiltinMcpServersByCategory();
  for (const [category, servers] of Object.entries(byCategory)) {
    lines.push(`  ${category}:`);
    for (const s of servers) {
      const enable = s.envEnable;
      const reqs = s.requiredEnv?.length
        ? ` [requires: ${s.requiredEnv.join(", ")}]`
        : "";
      const plat = s.platform
        ? ` (${s.platform.join("/")})`
        : "";
      lines.push(`    ${s.name}${plat} — ${enable}=true${reqs}`);
      lines.push(`      ${s.description.slice(0, 100)}`);
    }
    lines.push("");
  }

  lines.push("Enable via:");
  lines.push("  1. skeleton.yaml → mcp.servers.<name>: { env: { KEY: val } }");
  lines.push("  2. Environment → SKELETON_MCP_<NAME>=true");

  return lines.join("\n");
}
