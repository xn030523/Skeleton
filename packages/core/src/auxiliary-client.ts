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

type TaskKind = "vision" | "compression" | "webExtract" | "titleGeneration" | "judge" | "errorClassifier" | "sessionSearch" | "skillsHub" | "mcp";

export type AuxiliaryTaskConfig = {
  vision?: AuxiliaryModelConfig;
  compression?: AuxiliaryModelConfig;
  webExtract?: AuxiliaryModelConfig;
  titleGeneration?: AuxiliaryModelConfig;
  judge?: AuxiliaryModelConfig;
  errorClassifier?: AuxiliaryModelConfig;
  sessionSearch?: AuxiliaryModelConfig;
  skillsHub?: AuxiliaryModelConfig;
  mcp?: AuxiliaryModelConfig;
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
    const systemPrompt = "You are a summarization assistant.";
    const userInstruction = instruction ?? "Produce a concise, information-dense summary. Preserve exact values (paths, IDs, hashes) verbatim.";
    const messages: Message[] = [
      { role: "user", content: `${userInstruction}\n\n${text}` },
    ];
    try {
      const resp = await this.getTransport("compression").send(systemPrompt, messages, NO_TOOLS);
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

  /**
   * Analyze image via direct HTTP (bypasses Transport layer because
   * Message.content is string-only but vision requires multimodal blocks).
   *
   * Protocol-aware: OpenAI-compat sends `image_url` content block, Anthropic
   * sends `image` block with base64 source. Returns the analysis text.
   */
  async analyzeImage(imageData: string, question: string): Promise<string> {
    const cfg = this.resolveAuxConfig(this.auxConfig?.vision);
    try {
      if (cfg.protocol === "anthropic") {
        return await this.callAnthropicVision(cfg, imageData, question);
      }
      return await this.callOpenAIVision(cfg, imageData, question);
    } catch (err) {
      console.warn(`Auxiliary vision failed: ${(err as Error).message}`);
      return `Vision analysis error: ${(err as Error).message}`;
    }
  }

  /** Parse "data:image/xxx;base64,..." → { mediaType, data } */
  private parseDataUri(uri: string): { mediaType: string; data: string } | null {
    const m = /^data:([^;]+);base64,(.+)$/.exec(uri);
    if (!m) return null;
    return { mediaType: m[1], data: m[2] };
  }

  private async callOpenAIVision(cfg: LLMConfig, imageData: string, question: string): Promise<string> {
    // OpenAI-compatible multimodal: content is an array with image_url + text blocks.
    const parsed = this.parseDataUri(imageData);
    const imageUrl = parsed ? imageData : imageData;

    const base = (cfg.baseUrl || "").replace(/\/+$/, "");
    const endpoint = base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;

    const body = {
      model: cfg.model,
      max_tokens: cfg.maxTokens ?? 1024,
      temperature: cfg.temperature ?? 0.3,
      messages: [
        { role: "system", content: "You are a vision analysis assistant. Describe and analyze the provided image." },
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageUrl } },
            { type: "text", text: question },
          ],
        },
      ],
    };

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text().catch(() => "")}`);
    const data = await resp.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? "Unable to analyze image.";
  }

  private async callAnthropicVision(cfg: LLMConfig, imageData: string, question: string): Promise<string> {
    // Anthropic multimodal: content[] contains { type:"image", source:{type:"base64",...} }
    const parsed = this.parseDataUri(imageData);
    if (!parsed) {
      // Anthropic Messages API does not accept raw URLs — must be base64.
      throw new Error("Anthropic vision requires base64 data URI");
    }

    const base = (cfg.baseUrl || "").replace(/\/+$/, "");
    const endpoint = base.endsWith("/v1") ? `${base}/messages` : `${base}/v1/messages`;

    const body = {
      model: cfg.model,
      max_tokens: cfg.maxTokens ?? 1024,
      temperature: cfg.temperature ?? 0.3,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: parsed.mediaType, data: parsed.data } },
            { type: "text", text: question },
          ],
        },
      ],
    };

    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${await resp.text().catch(() => "")}`);
    const data = await resp.json() as { content?: Array<{ type: string; text?: string }> };
    const textBlock = data.content?.find(c => c.type === "text");
    return textBlock?.text ?? "Unable to analyze image.";
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

  /** Semantic session search — find relevant past conversations using auxiliary LLM */
  async searchSessions(query: string, sessionSummaries: string): Promise<string> {
    const prompt = `Given the following session summaries, find sessions relevant to this query: "${query}"\n\nSessions:\n${sessionSummaries.slice(0, 4000)}\n\nReturn the most relevant session IDs and brief reasons why they match.`;
    const messages: Message[] = [{ role: "user", content: prompt }];
    try {
      const resp = await this.getTransport("sessionSearch").send(prompt, messages, NO_TOOLS);
      return resp.content ?? "No relevant sessions found.";
    } catch (err) {
      console.warn(`Auxiliary session search failed: ${(err as Error).message}`);
      return `Session search error: ${(err as Error).message}`;
    }
  }

  /** Skills hub query — find and rank skills using auxiliary LLM */
  async querySkillsHub(query: string, skillList: string): Promise<string> {
    const prompt = `Given these available skills, find the most relevant ones for: "${query}"\n\nSkills:\n${skillList.slice(0, 4000)}\n\nReturn the top 5 most relevant skills with brief explanations.`;
    const messages: Message[] = [{ role: "user", content: prompt }];
    try {
      const resp = await this.getTransport("skillsHub").send(prompt, messages, NO_TOOLS);
      return resp.content ?? "No relevant skills found.";
    } catch (err) {
      console.warn(`Auxiliary skills hub query failed: ${(err as Error).message}`);
      return `Skills hub error: ${(err as Error).message}`;
    }
  }

  /** MCP routing — determine which MCP servers to invoke using auxiliary LLM */
  async routeMcp(query: string, mcpServerList: string): Promise<string> {
    const prompt = `Given these MCP servers, determine which ones should be invoked for: "${query}"\n\nServers:\n${mcpServerList.slice(0, 4000)}\n\nReturn the server names and the specific tools/capabilities to use, as a JSON array of {server, reason}.`;
    const messages: Message[] = [{ role: "user", content: prompt }];
    try {
      const resp = await this.getTransport("mcp").send(prompt, messages, NO_TOOLS);
      return resp.content ?? "[]";
    } catch (err) {
      console.warn(`Auxiliary MCP routing failed: ${(err as Error).message}`);
      return `MCP routing error: ${(err as Error).message}`;
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
