/**
 * Managed Tool Gateway — unified registration and routing for local
 * tools and remote MCP tools. Invocations auto-route to the correct handler.
 */

export interface GatewayToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  source: "local" | "mcp";
  mcpServer?: string;
}

export interface ToolInvocationResult {
  success: boolean;
  data?: unknown;
  error?: string;
  source: "local" | "mcp";
  durationMs: number;
}

type LocalHandler = (args: Record<string, unknown>) => Promise<unknown>;
type McpCaller = (server: string, toolName: string, args: Record<string, unknown>) => Promise<unknown>;

interface ToolEntry {
  def: GatewayToolDef;
  handler?: LocalHandler;
  mcpCaller?: McpCaller;
}

export class ManagedToolGateway {
  private tools = new Map<string, ToolEntry>();
  private mcpCaller?: McpCaller;

  constructor(opts?: { mcpCaller?: McpCaller }) {
    this.mcpCaller = opts?.mcpCaller;
  }

  /** Register a local tool with its handler function */
  registerTool(def: GatewayToolDef, handler: LocalHandler): void {
    if (def.source !== "local") {
      throw new Error(`Tool "${def.name}" source must be "local" for registerTool`);
    }
    this.tools.set(def.name, { def, handler });
  }

  /** Register a remote MCP tool; calls go through the MCP caller */
  registerMcpTool(server: string, toolDef: GatewayToolDef): void {
    if (toolDef.source !== "mcp") {
      throw new Error(`Tool "${toolDef.name}" source must be "mcp" for registerMcpTool`);
    }
    toolDef.mcpServer = server;
    this.tools.set(toolDef.name, { def: toolDef, mcpCaller: this.mcpCaller });
  }

  /** Invoke a tool by name — auto-routes to local handler or MCP caller */
  async invokeTool(name: string, args: Record<string, unknown>): Promise<ToolInvocationResult> {
    const entry = this.tools.get(name);
    if (!entry) {
      return { success: false, error: `Tool "${name}" not found`, source: "local", durationMs: 0 };
    }

    const start = Date.now();

    try {
      let data: unknown;

      if (entry.def.source === "local" && entry.handler) {
        data = await entry.handler(args);
      } else if (entry.def.source === "mcp" && entry.mcpCaller && entry.def.mcpServer) {
        data = await entry.mcpCaller(entry.def.mcpServer, name, args);
      } else {
        return {
          success: false,
          error: `No handler for tool "${name}"`,
          source: entry.def.source,
          durationMs: Date.now() - start,
        };
      }

      return { success: true, data, source: entry.def.source, durationMs: Date.now() - start };
    } catch (err) {
      return {
        success: false,
        error: (err as Error).message,
        source: entry.def.source,
        durationMs: Date.now() - start,
      };
    }
  }

  /** List all registered tool definitions */
  listTools(): GatewayToolDef[] {
    return [...this.tools.values()].map((e) => e.def);
  }

  /** Unregister a tool */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }
}
