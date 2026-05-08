import type { ToolDef } from "../types.js";
import type { AgentConfig } from "../types.js";
import { spawnSubAgent, spawnParallelSubAgents, type SubAgentResult } from "./index.js";

/**
 * delegate_task tool — lets the LLM spawn child agents for parallel or focused work.
 */
export function delegateTaskTool(
  parentConfig: AgentConfig,
  parentTools: () => ToolDef[],
): ToolDef {
  return {
    name: "delegate_task",
    description:
      "Spawn a sub-agent to handle a specific task in isolation. " +
      "The sub-agent gets a fresh conversation, restricted toolset (no delegate_task, skill_manage, cron_manage), " +
      "and focused system prompt. " +
      "Use 'parallel' mode to run multiple independent tasks concurrently. " +
      "Use for: complex analysis that benefits from isolation, parallel investigation of multiple hypotheses, " +
      "focused deep-dive on a specific sub-problem.",
    parameters: {
      type: "object",
      properties: {
        mode: {
          type: "string",
          enum: ["single", "parallel"],
          description: "Mode: 'single' for one task, 'parallel' for multiple concurrent tasks. Default: 'single'.",
        },
        task: {
          type: "string",
          description: "Task description (for single mode). Be specific about what the sub-agent should accomplish.",
        },
        system_prompt: {
          type: "string",
          description: "Optional system prompt override for the sub-agent. Use to focus the agent on a specific domain.",
        },
        max_turns: {
          type: "number",
          description: "Max turns for the sub-agent (default: 10, max: 20).",
        },
        allowed_tools: {
          type: "array",
          items: { type: "string" },
          description: "Allowlist of tool names the sub-agent can use. If omitted, all non-blocked tools are available.",
        },
        // Parallel mode fields
        tasks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              task: { type: "string" },
              system_prompt: { type: "string" },
              allowed_tools: { type: "array", items: { type: "string" } },
            },
            required: ["task"],
          },
          description: "Array of tasks for parallel mode. Each task has its own sub-agent.",
        },
        max_concurrency: {
          type: "number",
          description: "Max concurrent sub-agents for parallel mode (default: 3).",
        },
      },
      required: ["mode"],
    },
    execute: async (args) => {
      const mode = String(args.mode ?? "single");
      const tools = parentTools();

      if (mode === "parallel") {
        const tasks = args.tasks as Array<{ task: string; system_prompt?: string; allowed_tools?: string[] }>;
        if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
          return "Error: 'tasks' array is required for parallel mode.";
        }
        if (tasks.length > 5) {
          return "Error: maximum 5 parallel tasks at once.";
        }

        const results = await spawnParallelSubAgents(
          parentConfig,
          tools,
          tasks.map((t) => ({
            task: t.task,
            systemPromptOverride: t.system_prompt,
            allowedTools: t.allowed_tools,
          })),
          Number(args.max_concurrency ?? 3),
        );

        return formatParallelResults(results);
      }

      // Single mode
      const task = String(args.task ?? "");
      if (!task) return "Error: 'task' is required for single mode.";

      const result = await spawnSubAgent(parentConfig, tools, {
        task,
        systemPromptOverride: args.system_prompt ? String(args.system_prompt) : undefined,
        maxTurns: Math.min(Number(args.max_turns ?? 10), 20),
        allowedTools: args.allowed_tools as string[] | undefined,
      });

      return formatSingleResult(result);
    },
  };
}

function formatSingleResult(result: SubAgentResult): string {
  const lines = [
    `Sub-agent completed (task: ${result.taskId})`,
    `Status: ${result.success ? "SUCCESS" : "FAILED"}`,
  ];
  if (result.error) lines.push(`Error: ${result.error}`);
  if (result.toolCallsUsed.length > 0) {
    lines.push(`Tools used: ${result.toolCallsUsed.join(", ")}`);
  }
  lines.push("", "--- Output ---", result.output);
  return lines.join("\n");
}

function formatParallelResults(results: SubAgentResult[]): string {
  const lines = [`Parallel sub-agents completed: ${results.length} tasks`];
  for (const r of results) {
    const status = r.success ? "OK" : "FAIL";
    lines.push(`\n=== [${r.taskId}] ${status} ===`);
    if (r.error) lines.push(`Error: ${r.error}`);
    lines.push(r.output);
  }
  return lines.join("\n");
}
