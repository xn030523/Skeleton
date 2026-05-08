/**
 * RL Training infrastructure — batch evaluation runner
 * and tool-call parsers for different model formats.
 *
 * Inspired by Hermes environments/ and batch_runner.py (simplified).
 */

import fs from "node:fs";
import path from "node:path";
import type { AgentConfig, ToolCall } from "./types.js";
import { Agent } from "./agent.js";

export interface BatchConfig {
  inputFile: string;     // JSONL file with prompts
  outputFile: string;    // JSONL output file
  maxTurns?: number;
  parallelism?: number;
  stopOnError?: boolean;
}

interface BatchEntry {
  id: string;
  prompt: string;
  expected?: string;
}

interface BatchResult {
  id: string;
  prompt: string;
  response: string;
  toolCalls: number;
  turns: number;
  durationMs: number;
  error?: string;
}

/** Run a batch of prompts through the agent */
export async function runBatch(config: BatchConfig, agentConfig: AgentConfig): Promise<{ total: number; success: number; failed: number }> {
  const entries: BatchEntry[] = fs.readFileSync(config.inputFile, "utf-8")
    .split("\n")
    .filter(line => line.trim())
    .map(line => JSON.parse(line));

  const results: BatchResult[] = [];
  let success = 0;
  let failed = 0;
  const parallelism = config.parallelism ?? 1;

  // Process in chunks for controlled parallelism
  for (let i = 0; i < entries.length; i += parallelism) {
    const chunk = entries.slice(i, i + parallelism);
    const chunkResults = await Promise.all(
      chunk.map(async (entry) => {
        const start = Date.now();
        try {
          const agent = new Agent({
            ...agentConfig,
            maxTurns: config.maxTurns ?? agentConfig.maxTurns ?? 10,
          });

          const response = await agent.run(entry.prompt);
          const usage = agent.getUsage();
          await agent.close();

          return {
            id: entry.id,
            prompt: entry.prompt,
            response,
            toolCalls: usage.total.turns,
            turns: usage.total.turns,
            durationMs: Date.now() - start,
          } as BatchResult;
        } catch (err) {
          return {
            id: entry.id,
            prompt: entry.prompt,
            response: "",
            toolCalls: 0,
            turns: 0,
            durationMs: Date.now() - start,
            error: (err as Error).message,
          } as BatchResult;
        }
      }),
    );

    for (const r of chunkResults) {
      results.push(r);
      if (r.error) {
        failed++;
        if (config.stopOnError) break;
      } else {
        success++;
      }
    }
  }

  // Write results
  fs.mkdirSync(path.dirname(config.outputFile), { recursive: true });
  const outputLines = results.map(r => JSON.stringify(r));
  fs.writeFileSync(config.outputFile, outputLines.join("\n") + "\n");

  return { total: entries.length, success, failed };
}

/**
 * Tool-call parsers for different model output formats.
 * Handles variations in how models format tool calls.
 */
export const toolCallParsers: Record<string, (content: string) => ToolCall[]> = {
  /** Standard JSON tool call format */
  standard: (content) => {
    try {
      const parsed = JSON.parse(content);
      if (parsed.name && parsed.arguments) {
        return [{ id: `tc_${Date.now()}`, name: parsed.name, arguments: parsed.arguments }];
      }
    } catch { /* not JSON */ }
    return [];
  },

  /** DeepSeek-style function call format */
  deepseek: (content) => {
    const calls: ToolCall[] = [];
    const fnRe = /```tool_call\s*\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    while ((match = fnRe.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        calls.push({ id: `tc_${Date.now()}_${calls.length}`, name: parsed.name, arguments: parsed.arguments ?? {} });
      } catch { /* skip invalid */ }
    }
    return calls;
  },

  /** Qwen-style tool call format */
  qwen: (content) => {
    const calls: ToolCall[] = [];
    const re = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      try {
        const parsed = JSON.parse(match[1]);
        calls.push({ id: `tc_${Date.now()}_${calls.length}`, name: parsed.name ?? parsed.function?.name, arguments: parsed.arguments ?? parsed.function?.arguments ?? {} });
      } catch { /* skip invalid */ }
    }
    return calls;
  },

  /** Llama-style tool call format */
  llama: (content) => {
    const calls: ToolCall[] = [];
    const re = /\[TOOL_CALL\]\s*(\w+)\(([\s\S]*?)\)/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(content)) !== null) {
      try {
        const args = JSON.parse(match[2]);
        calls.push({ id: `tc_${Date.now()}_${calls.length}`, name: match[1], arguments: args });
      } catch {
        calls.push({ id: `tc_${Date.now()}_${calls.length}`, name: match[1], arguments: {} });
      }
    }
    return calls;
  },
};
