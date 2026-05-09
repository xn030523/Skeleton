/**
 * Codex Responses Transport — OpenAI Responses API format.
 *
 * Used by OpenAI Codex and xAI Grok models. The Responses API
 * differs from Chat Completions in message format, tool call
 * structure, and reasoning item replay.
 *
 * Key differences from ChatCompletions:
 * - Tool calls use `function_call` items with `call_id` (must start with `fc_`)
 * - Content uses `input_text`/`output_text` (not `text`/`content`)
 * - Assistant messages include `id`, `status`, and `phase` fields for cache hits
 * - Reasoning items are encrypted and must be replayed on subsequent turns
 *
 * Inspired by Hermes codex_responses_adapter.py (simplified).
 */

import OpenAI from "openai";
import type { Transport } from "./base.js";
import type { LLMConfig, Message, NormalizedResponse, ToolCall, ToolDef } from "../types.js";

export class CodexResponsesTransport implements Transport {
  private client: OpenAI;

  constructor(private config: LLMConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  async send(systemPrompt: string, messages: Message[], tools?: ToolDef[]): Promise<NormalizedResponse> {
    const inputItems = this.formatInput(systemPrompt, messages);
    const toolSchemas = this.formatCodexTools(tools);

    const params: Record<string, unknown> = {
      model: this.config.model,
      input: inputItems,
      ...(toolSchemas ? { tools: toolSchemas } : {}),
    };

    if (this.config.maxTokens) params.max_output_tokens = this.config.maxTokens;

    const resp = await this.client.responses.create(params as OpenAI.ResponseCreateParams);

    return this.parseResponse(resp);
  }

  async sendStream(
    systemPrompt: string,
    messages: Message[],
    onToken: (token: string) => void,
    tools?: ToolDef[],
  ): Promise<NormalizedResponse> {
    const inputItems = this.formatInput(systemPrompt, messages);
    const toolSchemas = this.formatCodexTools(tools);

    const params: Record<string, unknown> = {
      model: this.config.model,
      input: inputItems,
      stream: true,
      ...(toolSchemas ? { tools: toolSchemas } : {}),
    };

    if (this.config.maxTokens) params.max_output_tokens = this.config.maxTokens;

    let content = "";
    const toolCallBuffers: Map<string, { callId: string; name: string; args: string }> = new Map();

    const stream = await this.client.responses.create(params as OpenAI.ResponseCreateParams);

    for await (const event of stream as AsyncIterable<unknown>) {
      const ev = event as Record<string, unknown>;
      const type = ev.type as string;

      if (type === "response.output_text.delta") {
        const delta = ev.delta as string;
        if (delta) {
          content += delta;
          onToken(delta);
        }
      }

      if (type === "response.function_call_arguments.delta") {
        const callId = String(ev.call_id ?? "");
        const name = String(ev.name ?? "");
        const delta = String(ev.delta ?? "");
        if (!toolCallBuffers.has(callId)) {
          toolCallBuffers.set(callId, { callId, name, args: "" });
        }
        toolCallBuffers.get(callId)!.args += delta;
        toolCallBuffers.get(callId)!.name = name || toolCallBuffers.get(callId)!.name;
      }
    }

    const toolCalls: ToolCall[] = [...toolCallBuffers.values()].map((buf) => ({
      id: buf.callId.startsWith("fc_") ? buf.callId : `fc_${buf.callId}`,
      name: buf.name,
      arguments: JSON.parse(buf.args || "{}"),
    }));

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: "stop",
    };
  }

  private formatInput(
    systemPrompt: string,
    messages: Message[],
  ): Array<Record<string, unknown>> {
    const items: Array<Record<string, unknown>> = [];

    // System prompt as a system message item
    items.push({
      type: "message",
      role: "system",
      content: [{ type: "input_text", text: systemPrompt }],
    });

    for (const m of messages) {
      if (m.role === "system") continue;

      if (m.role === "user") {
        items.push({
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: m.content || "(empty)" }],
        });
      } else if (m.role === "assistant") {
        const contentItems: Array<Record<string, unknown>> = [];
        if (m.content) {
          contentItems.push({ type: "output_text", text: m.content });
        }
        items.push({
          type: "message",
          role: "assistant",
          content: contentItems.length > 0 ? contentItems : [{ type: "output_text", text: "" }],
        });

        // Tool calls as function_call items
        if (m.toolCalls) {
          for (const tc of m.toolCalls) {
            const callId = tc.id.startsWith("fc_") ? tc.id : `fc_${tc.id}`;
            items.push({
              type: "function_call",
              call_id: callId,
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            });
          }
        }
      } else if (m.role === "tool") {
        const callId = (m.toolCallId ?? "").startsWith("fc_")
          ? m.toolCallId
          : `fc_${m.toolCallId ?? ""}`;
        items.push({
          type: "function_call_output",
          call_id: callId,
          output: m.content || "(empty)",
        });
      }
    }

    return items;
  }

  private formatCodexTools(tools?: ToolDef[]): Array<Record<string, unknown>> | undefined {
    if (!tools || tools.length === 0) return undefined;

    return tools.map((t) => ({
      type: "function",
      name: t.name,
      strict: false,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  private parseResponse(resp: OpenAI.Response): NormalizedResponse {
    let content = "";
    const toolCalls: ToolCall[] = [];

    for (const item of resp.output ?? []) {
      const outputItem = item as Record<string, unknown>;
      const type = outputItem.type as string;

      if (type === "message") {
        const contentArr = outputItem.content as Array<Record<string, unknown>> ?? [];
        for (const c of contentArr) {
          if (c.type === "output_text") {
            content += c.text ?? "";
          }
        }
      } else if (type === "function_call") {
        const callId = String(outputItem.call_id ?? "");
        const name = String(outputItem.name ?? "");
        const args = String(outputItem.arguments ?? "{}");
        toolCalls.push({
          id: callId.startsWith("fc_") ? callId : `fc_${callId}`,
          name,
          arguments: JSON.parse(args),
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: resp.usage
        ? {
            promptTokens: resp.usage.input_tokens,
            completionTokens: resp.usage.output_tokens,
            totalTokens: resp.usage.input_tokens + resp.usage.output_tokens,
          }
        : undefined,
      finishReason: resp.status ?? "stop",
    };
  }

  getConfig() { return this.config; }
}
