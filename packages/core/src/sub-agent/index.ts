import type { AgentConfig, ToolDef } from "../types.js";
import { Agent } from "../agent.js";

/** Tools blocked in child agents (prevent escalation) */
const BLOCKED_TOOLS = new Set([
  "delegate_task",
  "skill_manage",
  "cron_manage",
  "consolidate_memories",
]);

/** Maximum nesting depth for sub-agents */
const MAX_DEPTH = 3;
const DEFAULT_DEPTH = 1;

export interface SubAgentResult {
  taskId: string;
  output: string;
  success: boolean;
  error?: string;
  toolCallsUsed: string[];
}

export interface DelegateTaskOptions {
  task: string;
  systemPromptOverride?: string;
  maxTurns?: number;
  depth?: number;
  allowedTools?: string[];
}

/**
 * Spawn a child agent with fresh conversation, restricted toolset, and focused system prompt.
 */
export async function spawnSubAgent(
  parentConfig: AgentConfig,
  parentTools: ToolDef[],
  options: DelegateTaskOptions,
  currentDepth: number = 0,
): Promise<SubAgentResult> {
  const depth = options.depth ?? DEFAULT_DEPTH;
  if (currentDepth >= MAX_DEPTH) {
    return {
      taskId: generateTaskId(),
      output: "",
      success: false,
      error: `Maximum nesting depth (${MAX_DEPTH}) reached`,
      toolCallsUsed: [],
    };
  }

  const taskId = generateTaskId();

  // Filter tools: remove blocked + apply allowlist
  let tools = parentTools.filter((t) => !BLOCKED_TOOLS.has(t.name));
  if (options.allowedTools && options.allowedTools.length > 0) {
    const allowed = new Set(options.allowedTools);
    tools = tools.filter((t) => allowed.has(t.name));
  }

  // Build focused system prompt
  const systemPrompt = options.systemPromptOverride
    ?? `You are a focused sub-agent executing a specific task.
Complete the task thoroughly and return your findings.
Do NOT spawn additional sub-agents.
Current depth: ${currentDepth + 1}/${MAX_DEPTH}.`;

  const childConfig: AgentConfig = {
    ...parentConfig,
    systemPrompt,
    maxTurns: options.maxTurns ?? Math.min(parentConfig.maxTurns ?? 20, 10),
    tools,
  };

  try {
    const agent = new Agent(childConfig);
    const usedToolNames: string[] = [];
    agent.onToolCall = (name: string) => { usedToolNames.push(name); };
    const output = await agent.run(options.task);
    await agent.close();

    return {
      taskId,
      output,
      success: true,
      toolCallsUsed: [...new Set(usedToolNames)],
    };
  } catch (err) {
    return {
      taskId,
      output: "",
      success: false,
      error: (err as Error).message,
      toolCallsUsed: [],
    };
  }
}

/**
 * Run multiple tasks in parallel using separate child agents.
 */
export async function spawnParallelSubAgents(
  parentConfig: AgentConfig,
  parentTools: ToolDef[],
  tasks: Array<{ task: string; systemPromptOverride?: string; allowedTools?: string[] }>,
  maxConcurrency: number = 3,
): Promise<SubAgentResult[]> {
  const results: SubAgentResult[] = [];

  for (let i = 0; i < tasks.length; i += maxConcurrency) {
    const chunk = tasks.slice(i, i + maxConcurrency);
    const chunkResults = await Promise.all(
      chunk.map((t) =>
        spawnSubAgent(parentConfig, parentTools, {
          task: t.task,
          systemPromptOverride: t.systemPromptOverride,
          allowedTools: t.allowedTools,
          maxTurns: 10,
        }),
      ),
    );
    results.push(...chunkResults);
  }

  return results;
}

function generateTaskId(): string {
  return `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export { delegateTaskTool } from "./tools.js";
