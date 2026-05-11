import type { ToolDef } from "../types.js";

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();
  private disabledToolsets = new Set<string>();

  constructor(tools: ToolDef[] = []) {
    for (const t of tools) {
      this.tools.set(t.name, t);
    }
  }

  register(tool: ToolDef): void {
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  async execute(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) throw new Error(`Tool not found: ${name}`);
    if (!this.isToolEnabled(tool)) throw new Error(`Tool "${name}" is disabled (toolset: ${tool.toolset})`);
    return tool.execute(args);
  }

  list(): ToolDef[] {
    return [...this.tools.values()].filter(t => this.isToolEnabled(t));
  }

  listAll(): ToolDef[] {
    return [...this.tools.values()];
  }

  getToolSchemas(): unknown[] {
    return this.list().map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  getAnthropicToolSchemas(): Array<{ name: string; description: string; input_schema: { type: "object" } & Record<string, unknown> }> {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: "object" as const,
        ...t.parameters,
      },
    }));
  }

  getToolsets(): Array<{ name: string; toolCount: number; enabled: boolean; tools: string[] }> {
    const groups = new Map<string, string[]>();
    const ungrouped: string[] = [];
    for (const t of this.tools.values()) {
      if (t.toolset) {
        const list = groups.get(t.toolset) ?? [];
        list.push(t.name);
        groups.set(t.toolset, list);
      } else {
        ungrouped.push(t.name);
      }
    }
    const result: Array<{ name: string; toolCount: number; enabled: boolean; tools: string[] }> = [];
    for (const [name, tools] of groups) {
      result.push({ name, toolCount: tools.length, enabled: !this.disabledToolsets.has(name), tools });
    }
    if (ungrouped.length > 0) {
      result.push({ name: "(default)", toolCount: ungrouped.length, enabled: true, tools: ungrouped });
    }
    return result;
  }

  enableToolset(name: string): boolean {
    return this.disabledToolsets.delete(name);
  }

  disableToolset(name: string): void {
    this.disabledToolsets.add(name);
  }

  isToolsetEnabled(name: string): boolean {
    return !this.disabledToolsets.has(name);
  }

  private isToolEnabled(t: ToolDef): boolean {
    if (!t.toolset) return true;
    return !this.disabledToolsets.has(t.toolset);
  }
}
