import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { ToolDef } from "../types.js";

/**
 * Self-hosting: expose Skeleton tools as an MCP server.
 * Other MCP clients (Claude Desktop, etc.) can connect to Skeleton
 * via stdio transport and use its tools.
 */
export class SkeletonMcpHost {
  private server: McpServer;
  private tools: ToolDef[];

  constructor(tools: ToolDef[], name = "skeleton", version = "0.1.0") {
    this.tools = tools;
    this.server = new McpServer({ name, version });

    // Register all tools as MCP tools
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  private registerTool(tool: ToolDef): void {
    const params = tool.parameters as { type: string; properties?: Record<string, unknown>; required?: string[] };
    this.server.tool(
      tool.name,
      tool.description,
      params.properties ?? {},
      async (args: Record<string, unknown>) => {
        try {
          const result = await tool.execute(args);
          const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
          return { content: [{ type: "text" as const, text }] };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }],
            isError: true,
          };
        }
      },
    );
  }

  /** Start the MCP server on stdio transport */
  async startStdio(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }

  /** Get the underlying McpServer instance */
  getServer(): McpServer {
    return this.server;
  }
}
