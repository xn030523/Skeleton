import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolDef } from "../types.js";
import type { McpServerConfig } from "../config/index.js";

export async function connectMcpServer(name: string, config: McpServerConfig): Promise<{ tools: ToolDef[]; client: Client }> {
  const client = new Client({ name: "skeleton", version: "0.1.0" });

  let transport;
  if (config.url) {
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamable-http.js");
    transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers: config.headers },
    });
  } else if (config.command) {
    transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: { ...process.env as Record<string, string>, ...config.env },
    });
  } else {
    throw new Error(`MCP server "${name}" must have either "command" or "url"`);
  }

  await client.connect(transport);

  const { tools } = await client.listTools();

  const toolDefs: ToolDef[] = (tools ?? []).map((t) => ({
    name: t.name,
    description: t.description ?? "",
    parameters: (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
    execute: async (args: Record<string, unknown>) => {
      const result = await client.callTool({ name: t.name, arguments: args });
      if (result.content && Array.isArray(result.content)) {
        const textParts = result.content
          .filter((c: any) => c.type === "text")
          .map((c: any) => c.text);
        if (textParts.length > 0) return textParts.join("\n");
        return JSON.stringify(result.content);
      }
      return JSON.stringify(result);
    },
  }));

  return { tools: toolDefs, client };
}

export async function connectAllMcpServers(
  servers: Record<string, McpServerConfig>,
): Promise<{ tools: ToolDef[]; clients: Client[] }> {
  const allTools: ToolDef[] = [];
  const clients: Client[] = [];

  const entries = Object.entries(servers);
  const results = await Promise.allSettled(
    entries.map(([name, config]) => connectMcpServer(name, config)),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      allTools.push(...result.value.tools);
      clients.push(result.value.client);
    } else {
      const name = entries[i][0];
      console.error(`MCP server "${name}" failed: ${result.reason}`);
    }
  }

  return { tools: allTools, clients };
}
