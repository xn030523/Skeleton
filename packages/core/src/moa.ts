/**
 * Mixture of Agents (MoA) — parallel reference model responses
 * + aggregator synthesis for complex reasoning.
 *
 * Inspired by Hermes mixture_of_agents_tool.py.
 */

import type { AgentConfig, Message, NormalizedResponse } from "./types.js";
import { Agent } from "./agent.js";

export interface MoaConfig {
  referenceModels?: Array<{ model: string; baseUrl?: string; apiKey?: string }>;
  maxReferences?: number;
}

const DEFAULT_MOA: MoaConfig = {
  maxReferences: 3,
};

/**
 * Run MoA: query multiple reference models in parallel, then
 * aggregate their responses into a single high-quality answer.
 */
export async function runMoa(
  query: string,
  primaryConfig: AgentConfig,
  moaConfig: MoaConfig = {},
): Promise<string> {
  const cfg = { ...DEFAULT_MOA, ...moaConfig };
  const refs = cfg.referenceModels ?? [];

  if (refs.length === 0) {
    // No reference models configured — just use primary
    const agent = new Agent(primaryConfig);
    return agent.run(query);
  }

  // Query reference models in parallel
  const referenceResponses = await Promise.all(
    refs.slice(0, cfg.maxReferences).map(async (ref) => {
      try {
        const refConfig: AgentConfig = {
          ...primaryConfig,
          llm: {
            ...primaryConfig.llm,
            model: ref.model,
            baseUrl: ref.baseUrl ?? primaryConfig.llm.baseUrl,
            apiKey: ref.apiKey ?? primaryConfig.llm.apiKey,
          },
          maxTurns: 1, // Single response, no tool use
        };
        const agent = new Agent(refConfig);
        const response = await agent.run(query);
        await agent.close();
        return { model: ref.model, response };
      } catch (err) {
        return { model: ref.model, response: `Error: ${(err as Error).message}` };
      }
    }),
  );

  // Aggregate: feed all reference responses to the primary model
  const aggregatorPrompt =
    `You are aggregating responses from multiple reference models. ` +
    `Synthesize the best aspects of each response into a single, comprehensive answer. ` +
    `Resolve contradictions by favoring the most detailed and well-reasoned position. ` +
    `Do NOT just copy one response — combine insights.\n\n` +
    referenceResponses
      .map((r, i) => `## Reference ${i + 1} (${r.model})\n${r.response}`)
      .join("\n\n");

  const agent = new Agent(primaryConfig);
  const result = await agent.run(aggregatorPrompt);
  await agent.close();
  return result;
}

/**
 * Build MoA tool for LLM to invoke.
 */
export function moaTool(config: AgentConfig, moaConfig: MoaConfig = {}): import("./types.js").ToolDef {
  return {
    name: "mixture_of_agents",
    description:
      "Query multiple AI models in parallel and synthesize their responses. " +
      "Use for complex reasoning tasks that benefit from diverse perspectives. " +
      "Returns a single aggregated answer combining the best insights from all models.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The question or task to send to all reference models",
        },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const query = String(args.query ?? "");
      if (!query) return "Error: no query provided";
      return runMoa(query, config, moaConfig);
    },
    toolset: "system",
    emoji: "🧪",
  };
}
