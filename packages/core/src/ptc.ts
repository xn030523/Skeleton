/**
 * Programmatic Tool Calling (PTC) — LLM generates a script that
 * calls tools via RPC, collapsing multi-step chains into one turn.
 *
 * Inspired by Hermes code_execution_tool.py (simplified — uses
 * in-process eval instead of UDS RPC).
 */

import type { ToolDef } from "./types.js";
import type { ToolRegistry } from "./tools/registry.js";

export interface PtcConfig {
  language: "javascript" | "python";
  maxOutputLength?: number;
  timeout?: number;
}

const DEFAULT_CONFIG: PtcConfig = {
  language: "javascript",
  maxOutputLength: 10000,
  timeout: 30000,
};

/**
 * Build a PTC tool definition that lets the LLM execute scripts
 * with tool access.
 */
export function ptcTool(registry: ToolRegistry, config: Partial<PtcConfig> = {}): ToolDef {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  return {
    name: "code_execute",
    description:
      "Execute a script with tool access. The script can call available tools via the `call_tool(name, args)` function. " +
      "This collapses multi-step operations into a single turn. Use for complex workflows that would otherwise require many sequential tool calls. " +
      "Return a string result from your script.",
    parameters: {
      type: "object",
      properties: {
        script: {
          type: "string",
          description: "JavaScript code to execute. Use `call_tool(name, args)` to invoke tools. Must return a string.",
        },
        language: {
          type: "string",
          enum: ["javascript"],
          description: "Script language (currently only JavaScript supported)",
        },
      },
      required: ["script"],
    },
    execute: async (args) => {
      const script = String(args.script ?? "");
      if (!script) return "Error: no script provided";

      // Build the call_tool function that delegates to the registry
      const availableTools = registry.list();
      const toolMap = new Map(availableTools.map(t => [t.name, t]));

      const callTool = async (name: string, toolArgs: Record<string, unknown>): Promise<unknown> => {
        const tool = toolMap.get(name);
        if (!tool) return `Error: tool "${name}" not found`;
        try {
          const result = await tool.execute(toolArgs);
          return result;
        } catch (err) {
          return `Error calling ${name}: ${(err as Error).message}`;
        }
      };

      try {
        // Execute the script in a sandboxed async function
        const fn = new Function("call_tool", `return (async () => { ${script} })()`);
        const result = await fn(callTool);

        const resultStr = typeof result === "string" ? result : JSON.stringify(result, null, 2) ?? String(result);
        if (resultStr.length > cfg.maxOutputLength!) {
          return resultStr.slice(0, cfg.maxOutputLength!) + "\n[...output truncated...]";
        }
        return resultStr;
      } catch (err) {
        return `Script error: ${(err as Error).message}`;
      }
    },
    toolset: "system",
    emoji: "⚡",
  };
}
