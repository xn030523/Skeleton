/**
 * Auxiliary LLM client for secondary tasks.
 *
 * Uses a separate transport instance so summarization, vision,
 * and title generation don't consume the main session's context
 * window or API quota. Falls back to the primary transport
 * if no auxiliary config is provided.
 *
 * Phase 3: Supports per-task model routing.
 * Different sub-tasks (vision, compression, webExtract, judge)
 * can use different cheaper/faster models to reduce cost.
 */

import type { AuxiliaryModelConfig, LLMConfig, Message, ToolDef } from "./types.js";
import { ChatCompletionsTransport } from "./transports/chat-completions.js";
import { AnthropicTransport } from "./transports/anthropic.js";
import type { Transport } from "./transports/base.js";
import { findProvider, resolveProviderConfig } from "./providers/registry.js";

const NO_TOOLS: ToolDef[] | undefined = undefined;

type TaskKind = "vision" | "compression" | "webExtract" | "titleGeneration" | "judge" | "errorClassifier";

export type AuxiliaryTaskConfig = {
  vision?: AuxiliaryModelConfig;
  compression?: AuxiliaryModelConfig;
  webExtract?: AuxiliaryModelConfig;
  titleGeneration?: AuxiliaryModelConfig;
  judge?: AuxiliaryModelConfig;
  errorClassifier?: AuxiliaryModelConfig;
};

export class AuxiliaryClient {
  /** Default transport (used when no task-specific routing is configured) */
  private defaultTransport: Transport;
  /** Per-task transport cache — lazily built from auxConfig */
  private taskTransports = new Map<TaskKind, Transport>();
  /** Primary LLM config (for "auto" fallback) */
  private primaryConfig: LLMConfig;
  /** Per-task auxiliary config (from AgentConfig.auxiliary) */
  private auxConfig?: AuxiliaryTaskConfig;

  constructor(config: LLMConfig, auxConfig?: AuxiliaryTaskConfig) {
    this.primaryConfig = config;
    this.auxConfig = auxConfig;
    this.defaultTransport = this.buildTransport(config);
  }

  private buildTransport(config: LLMConfig): Transport {
    if (config.protocol === "anthropic") {
      return new AnthropicTransport(config);
    }
    return new ChatCompletionsTransport(config);
  }

  /**
   * Resolve an LLMConfig from an AuxiliaryModelConfig.
   * Priority:
   *   1. Explicit baseUrl + apiKey in taskConfig
   *   2. Provider name → resolve via registry
   *   3. "auto" or unset → fall back to primary config
   */
  private resolveAuxConfig(taskConfig?: AuxiliaryModelConfig): LLMConfig {
    if (!taskConfig || taskConfig.provider === "auto" || !taskConfig.provider) {
      return {
        ...this.primaryConfig,
        model: taskConfig?.model ?? this.primaryConfig.model,
        baseUrl: taskConfig?.baseUrl ?? this.primaryConfig.baseUrl,
        apiKey: taskConfig?.apiKey ?? this.primaryConfig.apiKey,
        maxTokens: 1024,
        temperature: 0.3,
      };
    }

    // Provider-based resolution
    const profile = findProvider(taskConfig.provider);
    if (profile) {
      return resolveProviderConfig(profile, {
        model: taskConfig.model,
        baseUrl: taskConfig.baseUrl,
        apiKey: taskConfig.apiKey,
        maxTokens: 1024,
        temperature: 0.3,
      });
    }

    console.warn(`Auxiliary: unknown provider "${taskConfig.provider}", using primary config`);
    return { ...this.primaryConfig, maxTokens: 1024, temperature: 0.3 };
  }

  /** Get (or lazily build) the transport for a specific task */
  private getTransport(task: TaskKind): Transport {
    const cached = this.taskTransports.get(task);
    if (cached) return cached;

    const taskConfig = this.auxConfig?.[task];
    if (!taskConfig || (taskConfig.provider === "auto" && !taskConfig.model && !taskConfig.baseUrl)) {
      return this.defaultTransport;
    }

    const resolved = this.resolveAuxConfig(taskConfig);
    const transport = this.buildTransport(resolved);
    this.taskTransports.set(task, transport);
    return transport;
  }

  /** Summarize text (e.g. conversation compression) */
  async summarize(text: string, instruction?: string): Promise<string> {
    const prompt = instruction ?? "Produce a concise, information-dense summary. Preserve exact values (paths, IDs, hashes) verbatim.";
    const messages: Message[] = [
      { role: "user", content: `${prompt}\n\n${text}` },
    ];
    try {
      const resp = await this.getTransport("compression").send(prompt, messages, NO_TOOLS);
      return resp.content ?? "";
    } catch (err) {
      console.warn(`Auxiliary summarize failed: ${(err as Error).message}`);
      return text.length > 2000 ? text.slice(0, 2000) + "\n[...truncated]" : text;
    }
  }

  /** Generate a session title from the first exchange */
  async generateTitle(userMsg: string, assistantMsg: string): Promise<string> {
    const prompt = "Generate a short session title (max 60 chars, no quotes) summarizing this conversation. Return ONLY the title text.";
    const messages: Message[] = [
      { role: "user", content: userMsg.slice(0, 500) },
      { role: "assistant", content: assistantMsg.slice(0, 500) },
      { role: "user", content: prompt },
    ];
    try {
      const resp = await this.getTransport("titleGeneration").send(prompt, messages, NO_TOOLS);
      const title = resp.content?.trim() ?? "Untitled";
      return title.length > 60 ? title.slice(0, 60) : title;
    } catch (err) {
      console.warn(`Auxiliary title generation failed: ${(err as Error).message}`);
      return userMsg.slice(0, 50).replace(/\n/g, " ") || "Untitled";
    }
  }

  /** Analyze an image URL or base64 data URI */
  async analyzeImage(imageData: string, question: string): Promise<string> {
    const messages: Message[] = [
      {
        role: "user",
        content: `[Image attached: ${imageData.startsWith("data:") ? "base64" : "URL"}]\n\n${question}`,
      },
    ];
    try {
      const resp = await this.getTransport("vision").send(
        "You are a vision analysis assistant. Describe and analyze the provided image.",
        messages,
        NO_TOOLS,
      );
      return resp.content ?? "Unable to analyze image.";
    } catch (err) {
      console.warn(`Auxiliary vision failed: ${(err as Error).message}`);
      return `Vision analysis error: ${(err as Error).message}`;
    }
  }

  /** Classify an error for retry logic */
  async classifyError(errorMessage: string): Promise<string> {
    const prompt = "Classify this API error as one of: rate_limit, auth_error, server_error, timeout, context_overflow, billing, unknown. Return ONLY the classification label.";
    const messages: Message[] = [
      { role: "user", content: `Error message:\n${errorMessage.slice(0, 1000)}` },
    ];
    try {
      const resp = await this.getTransport("errorClassifier").send(prompt, messages, NO_TOOLS);
      const label = resp.content?.trim().toLowerCase() ?? "unknown";
      const valid = ["rate_limit", "auth_error", "server_error", "timeout", "context_overflow", "billing", "unknown"];
      return valid.includes(label) ? label : "unknown";
    } catch {
      return "unknown";
    }
  }

  /**
   * Judge whether a goal has been satisfied by the agent's last response.
   * Uses the "judge" auxiliary transport (typically a cheap/fast model).
   * Fail-OPEN: any error returns { done: false } so progress flows.
   */
  async judgeGoal(goal: string, lastResponse: string): Promise<{ done: boolean; reason: string }> {
    const systemPrompt = (
      "You are a strict judge evaluating whether an autonomous agent has " +
      "achieved a user's stated goal. You receive the goal text and the " +
      "agent's most recent response. Your only job is to decide whether " +
      "the goal is fully satisfied based on that response.\n\n" +
      "A goal is DONE only when:\n" +
      "- The response explicitly confirms the goal was completed, OR\n" +
      "- The response clearly shows the final deliverable was produced, OR\n" +
      "- The response explains the goal is unachievable / blocked / needs " +
      "user input (treat this as DONE with reason describing the block).\n\n" +
      "Otherwise the goal is NOT done — CONTINUE.\n\n" +
      "Reply ONLY with a single JSON object on one line:\n" +
      '{"done": <true|false>, "reason": "<one-sentence rationale>"}'
    );

    const userPrompt = (
      `Goal:\n${goal}\n\n` +
      `Agent's most recent response:\n${lastResponse.slice(0, 4000)}\n\n` +
      "Is the goal satisfied?"
    );

    try {
      const resp = await this.getTransport("judge").send(
        systemPrompt,
        [{ role: "user", content: userPrompt }],
        NO_TOOLS,
      );
      const raw = (resp.content ?? "").trim();
      const jsonMatch = raw.match(/\{[^}]*"done"[^}]*\}/);
      if (!jsonMatch) {
        return { done: false, reason: "judge reply was not JSON" };
      }
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        done: Boolean(parsed.done),
        reason: String(parsed.reason ?? ""),
      };
    } catch (err) {
      return { done: false, reason: `judge error: ${(err as Error).message}` };
    }
  }
}

/**
 * Build an AuxiliaryClient from config.
 * Phase 3: Accepts per-task auxiliary config from AgentConfig.auxiliary.
 *
 * Resolution order for default transport:
 *   1. SKELETON_AUX_* env vars (legacy override)
 *   2. Primary LLM config (fallback)
 */
export function buildAuxiliaryClient(
  primary: LLMConfig,
  auxiliaryConfig?: AuxiliaryTaskConfig,
): AuxiliaryClient {
  const envAuxConfig: LLMConfig = {
    protocol: (process.env.SKELETON_AUX_PROTOCOL as LLMConfig["protocol"]) ?? primary.protocol,
    apiKey: process.env.SKELETON_AUX_API_KEY ?? primary.apiKey,
    baseUrl: process.env.SKELETON_AUX_BASE_URL ?? primary.baseUrl,
    model: process.env.SKELETON_AUX_MODEL ?? primary.model,
    maxTokens: 1024,
    temperature: 0.3,
  };
  return new AuxiliaryClient(envAuxConfig, auxiliaryConfig);
}
