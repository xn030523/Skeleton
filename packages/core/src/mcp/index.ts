import type { McpServerConfig } from "../../config/index.js";
import type { BuiltinMcpServer } from "./jshook.js";
import { jshookServer } from "./jshook.js";

export type { BuiltinMcpServer } from "./jshook.js";

const BUILTIN_MCP_SERVERS: BuiltinMcpServer[] = [
  jshookServer,
];

/** Build merged MCP servers config: built-in defaults + user overrides from yaml */
export function buildMcpServersConfig(
  userServers?: Record<string, McpServerConfig>,
): Record<string, McpServerConfig> {
  const servers: Record<string, McpServerConfig> = { ...userServers };

  for (const builtin of BUILTIN_MCP_SERVERS) {
    // User can override a built-in by defining same name in yaml
    if (servers[builtin.name]) continue;

    // Check env disable flag
    const disabled = (process.env[builtin.envDisable] ?? "").toLowerCase() === "false";
    if (disabled) continue;

    servers[builtin.name] = builtin.config;
  }

  return servers;
}

/** List all built-in MCP server definitions (for display/metadata) */
export function listBuiltinMcpServers(): BuiltinMcpServer[] {
  return [...BUILTIN_MCP_SERVERS];
}

export { jshookServer };
