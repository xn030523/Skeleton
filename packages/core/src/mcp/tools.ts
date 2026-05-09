import type { ToolDef } from "../types.js";
import type { McpServerConfig } from "../config/index.js";
import type { Agent } from "../agent.js";
import { BUILTIN_MCP_SERVERS } from "./servers.js";
import { listBuiltinMcpServersByCategory } from "./index.js";
import { connectMcpServer } from "../tools/mcp.js";
import { scanMcpToolList } from "../tools/security.js";
import { scanMcpCommandForOsv } from "../tools/osv.js";
import { checkCommandAvailability } from "./resolve.js";

export function mcpManageTool(agent: Agent): ToolDef {
  return {
    name: "mcp_manage",
    description:
      "Dynamically manage MCP server connections at runtime. List connected servers, browse built-in servers, enable/disable servers, add custom servers, or probe a server's available tools without connecting it.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "builtin", "enable", "disable", "add", "probe"],
          description: "Action to perform",
        },
        name: {
          type: "string",
          description: "MCP server name (for enable/disable/add/probe)",
        },
        command: {
          type: "string",
          description: "Command for stdio server (add/probe action)",
        },
        args: {
          type: "array",
          items: { type: "string" },
          description: "Args for command (add/probe action)",
        },
        url: {
          type: "string",
          description: "URL for HTTP transport server (add/probe action)",
        },
        env: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Additional environment variables (add/enable/probe action)",
        },
        headers: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "HTTP headers for URL-based server (add/probe action)",
        },
      },
      required: ["action"],
    },
    execute: async (args) => {
      const {
        action, name, command, args: cmdArgs, url, env, headers,
      } = args as {
        action: string;
        name?: string;
        command?: string;
        args?: string[];
        url?: string;
        env?: Record<string, string>;
        headers?: Record<string, string>;
      };

      switch (action) {
        case "list":
          return listConnected(agent);

        case "builtin":
          return listBuiltin(agent);

        case "enable":
          return enableBuiltin(agent, name ?? "", env);

        case "disable":
          return disableServer(agent, name ?? "");

        case "add":
          return addCustom(agent, name ?? "", command, cmdArgs, url, env, headers);

        case "probe":
          return probeServer(name ?? "", command, cmdArgs, url, env, headers);

        default:
          return { error: `Unknown action: ${action}. Supported: list, builtin, enable, disable, add, probe` };
      }
    },
  };
}

function listConnected(agent: Agent) {
  const entries = [...agent.getMcpServerTools().entries()] as [string, { toolNames: string[] }][];
  if (entries.length === 0) {
    return { servers: [], message: "No MCP servers currently connected" };
  }
  return {
    servers: entries.map(([name, { toolNames }]) => ({
      name,
      toolCount: toolNames.length,
      tools: toolNames,
    })),
  };
}

function listBuiltin(agent: Agent) {
  const connected = new Set(agent.getMcpServerTools().keys());
  const byCategory = listBuiltinMcpServersByCategory();

  const result: Record<string, Array<{
    name: string;
    description: string;
    connected: boolean;
    envSatisfied: boolean;
    platformOk: boolean;
    commandAvailable: boolean;
    installHint: string | null;
    envEnable: string;
    requiredEnv?: string[];
    optionalEnv?: string[];
  }>> = {};

  for (const [category, servers] of Object.entries(byCategory)) {
    result[category] = servers.map((s) => {
      const cmd = s.config.command;
      const cmdCheck = cmd ? checkCommandAvailability(cmd) : { available: true, installHint: null };
      return {
        name: s.name,
        description: s.description,
        connected: connected.has(s.name),
        envSatisfied: !s.requiredEnv?.some((v) => !process.env[v]),
        platformOk: !s.platform || s.platform.includes(process.platform),
        commandAvailable: cmdCheck.available,
        installHint: cmdCheck.installHint,
        envEnable: s.envEnable,
        requiredEnv: s.requiredEnv,
        optionalEnv: s.optionalEnv,
      };
    });
  }

  return result;
}

async function enableBuiltin(agent: Agent, name: string, env?: Record<string, string>) {
  if (!name) return { error: "Missing 'name' parameter for enable" };

  const builtin = BUILTIN_MCP_SERVERS.find((s) => s.name === name);
  if (!builtin) return { error: `Unknown built-in server: ${name}. Use 'builtin' action to see available servers.` };

  if (builtin.platform && !builtin.platform.includes(process.platform)) {
    return { error: `Server "${name}" not available on ${process.platform}. Supported: ${builtin.platform.join("/")}` };
  }

  if (builtin.requiredEnv) {
    const missing = builtin.requiredEnv.filter((v) => !process.env[v] && !env?.[v]);
    if (missing.length > 0) {
      return { error: `Missing required env: ${missing.join(", ")}. Set these environment variables before enabling.` };
    }
  }

  // Pre-flight: check command availability (Hermes-style shutil.which() check)
  if (builtin.config.command) {
    const cmdCheck = checkCommandAvailability(builtin.config.command);
    if (!cmdCheck.available) {
      const hint = cmdCheck.installHint ?? "Install the required tool and try again.";
      return {
        error: `Command "${builtin.config.command}" not found on this system. ${hint}`,
      };
    }
  }

  const config: McpServerConfig = {
    ...builtin.config,
    env: { ...builtin.config.env, ...env },
  };

  // OSV scan for npm/npx commands
  if (config.command) {
    const osvResult = await scanMcpCommandForOsv(config.command, config.args);
    if (!osvResult.safe) {
      return {
        error: `SECURITY: Package "${osvResult.package}" has known vulnerabilities:\n` +
          osvResult.vulnerabilities.map((v) => `  - ${v.id}: ${v.summary} (${v.severity ?? "unknown"})`).join("\n") +
          "\nReview and set SKELETON_SKIP_OSV=true to bypass if intentional.",
      };
    }
  }

  try {
    return await agent.addMcpServer(name, config);
  } catch (err) {
    return { error: `Failed to enable "${name}": ${(err as Error).message}` };
  }
}

async function disableServer(agent: Agent, name: string) {
  if (!name) return { error: "Missing 'name' parameter for disable" };

  const result = await agent.removeMcpServer(name);
  if (!result) return { error: `Server "${name}" is not connected` };
  return { success: true, message: `Disconnected server "${name}"` };
}

async function addCustom(
  agent: Agent,
  name: string,
  command?: string,
  args?: string[],
  url?: string,
  env?: Record<string, string>,
  headers?: Record<string, string>,
) {
  if (!name) return { error: "Missing 'name' parameter for add" };
  if (!command && !url) return { error: "Must provide either 'command' or 'url'" };

  // Pre-flight: check command availability
  if (command) {
    const cmdCheck = checkCommandAvailability(command);
    if (!cmdCheck.available) {
      const hint = cmdCheck.installHint ?? "Install the required tool and try again.";
      return {
        error: `Command "${command}" not found on this system. ${hint}`,
      };
    }
  }

  const config: McpServerConfig = {};
  if (url) {
    config.url = url;
    if (headers) config.headers = headers;
  }
  if (command) {
    config.command = command;
    if (args) config.args = args;
    if (env) config.env = env;
  }

  // OSV scan for npm/npx commands
  if (config.command) {
    const osvResult = await scanMcpCommandForOsv(config.command, config.args);
    if (!osvResult.safe) {
      return {
        error: `SECURITY: Package "${osvResult.package}" has known vulnerabilities:\n` +
          osvResult.vulnerabilities.map((v) => `  - ${v.id}: ${v.summary} (${v.severity ?? "unknown"})`).join("\n") +
          "\nReview and set SKELETON_SKIP_OSV=true to bypass if intentional.",
      };
    }
  }

  try {
    return await agent.addMcpServer(name, config);
  } catch (err) {
    return { error: `Failed to add server "${name}": ${(err as Error).message}` };
  }
}

async function probeServer(
  name: string,
  command?: string,
  args?: string[],
  url?: string,
  env?: Record<string, string>,
  headers?: Record<string, string>,
) {
  if (!name) return { error: "Missing 'name' parameter for probe" };
  if (!command && !url) return { error: "Must provide either 'command' or 'url'" };

  const config: McpServerConfig = {};
  if (url) {
    config.url = url;
    if (headers) config.headers = headers;
  }
  if (command) {
    config.command = command;
    if (args) config.args = args;
    if (env) config.env = env;
  }

  try {
    const { tools, client } = await connectMcpServer(name, config);
    const toolList = tools.map((t) => ({ name: t.name, description: t.description }));
    try { (client as { close?: () => void }).close?.(); } catch {}
    return { name, toolCount: toolList.length, tools: toolList };
  } catch (err) {
    return { error: `Probe failed for "${name}": ${(err as Error).message}` };
  }
}
