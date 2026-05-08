import type { ToolDef } from "../types.js";

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  constructor(tools: ToolDef[] = []) {
    for (const t of tools) {
      this.tools.set(t.name, t);
    }
  }

  register(tool: ToolDef): void {
    this.tools.set(tool.name, tool);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    return tool.execute(args);
  }

  list(): ToolDef[] {
    return [...this.tools.values()];
  }

  getToolSchemas(): unknown[] {
    return [...this.tools.values()].map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  getAnthropicToolSchemas(): Array<{ name: string; description: string; input_schema: { type: "object" } & Record<string, unknown> }> {
    return [...this.tools.values()].map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: "object" as const,
        ...t.parameters,
      },
    }));
  }
}
