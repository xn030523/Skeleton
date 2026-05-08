/**
 * Auxiliary LLM client for secondary tasks.
 *
 * Uses a separate transport instance so summarization, vision,
 * and title generation don't consume the main session's context
 * window or API quota. Falls back to the primary transport
 * if no auxiliary config is provided.
 */

import type { LLMConfig, Message, NormalizedResponse, ToolDef } from "./types.js";
import { ChatCompletionsTransport } from "./transports/chat-completions.js";
import { AnthropicTransport } from "./transports/anthropic.js";
import type { Transport } from "./transports/base.js";
import { redactSensitiveText } from "./redact.js";

const NO_TOOLS: ToolDef[] | undefined = undefined;

export class AuxiliaryClient {
  private transport: Transport;

  constructor(config: LLMConfig) {
    if (config.protocol === "anthropic") {
      this.transport = new AnthropicTransport(config);
    } else {
      this.transport = new ChatCompletionsTransport(config);
    }
  }

  /** Summarize text (e.g. conversation compression) */
  async summarize(text: string, instruction?: string): Promise<string> {
    const prompt = instruction ?? "Produce a concise, information-dense summary. Preserve exact values (paths, IDs, hashes) verbatim.";
    const messages: Message[] = [
      { role: "user", content: `${prompt}\n\n${text}` },
    ];
    try {
      const resp = await this.transport.send(prompt, messages, NO_TOOLS);
      return resp.content ?? "";
    } catch (err) {
      console.warn(`Auxiliary summarize failed: ${(err as Error).message}`);
      // Fallback: return truncated original
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
      const resp = await this.transport.send(prompt, messages, NO_TOOLS);
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
      const resp = await this.transport.send(
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
      const resp = await this.transport.send(prompt, messages, NO_TOOLS);
      const label = resp.content?.trim().toLowerCase() ?? "unknown";
      const valid = ["rate_limit", "auth_error", "server_error", "timeout", "context_overflow", "billing", "unknown"];
      return valid.includes(label) ? label : "unknown";
    } catch {
      return "unknown";
    }
  }
}

/**
 * Build an AuxiliaryClient from config.
 * Uses SKELETON_AUX_* env vars, or falls back to the primary LLM config.
 */
export function buildAuxiliaryClient(primary: LLMConfig): AuxiliaryClient {
  const auxConfig: LLMConfig = {
    protocol: (process.env.SKELETON_AUX_PROTOCOL as LLMConfig["protocol"]) ?? primary.protocol,
    apiKey: process.env.SKELETON_AUX_API_KEY ?? primary.apiKey,
    baseUrl: process.env.SKELETON_AUX_BASE_URL ?? primary.baseUrl,
    model: process.env.SKELETON_AUX_MODEL ?? primary.model,
    maxTokens: 1024,
    temperature: 0.3,
  };
  return new AuxiliaryClient(auxConfig);
}
