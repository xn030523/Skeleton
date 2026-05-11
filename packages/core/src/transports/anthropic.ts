import Anthropic from "@anthropic-ai/sdk";
import type { Transport } from "./base.js";
import type { LLMConfig, Message, NormalizedResponse, ToolCall, ToolDef } from "../types.js";
import type { ProviderQuirks } from "../providers/registry.js";
import { findProvider } from "../providers/registry.js";

export interface AnthropicTransportOptions {
  /** Provider quirks for third-party endpoint adaptation */
  quirks?: ProviderQuirks;
}

export class AnthropicTransport implements Transport {
  private client: Anthropic;
  private quirks: ProviderQuirks;

  constructor(private config: LLMConfig, options?: AnthropicTransportOptions) {
    this.quirks = options?.quirks ?? this.inferQuirks();

    const clientOpts: Anthropic.ClientOptions = {
      apiKey: config.apiKey || "sk-placeholder",
      baseURL: config.baseUrl,
    };

    // Third-party Anthropic endpoints need Bearer auth instead of x-api-key
    if (this.quirks.authMode === "bearer") {
      clientOpts.defaultHeaders = {
        ...clientOpts.defaultHeaders,
        Authorization: `Bearer ${config.apiKey}`,
        "x-api-key": undefined as unknown as string, // Remove default header
      };
    }

    // Custom headers from provider quirks
    if (this.quirks.customHeaders) {
      clientOpts.defaultHeaders = {
        ...clientOpts.defaultHeaders,
        ...this.quirks.customHeaders,
      };
    }

    // Third-party endpoints: strip beta headers that cause rejections
    if (this.quirks.stripBetaHeaders?.length) {
      clientOpts.defaultHeaders = {
        ...clientOpts.defaultHeaders,
        ...Object.fromEntries(this.quirks.stripBetaHeaders.map(h => [h, undefined])),
      };
    }

    this.client = new Anthropic(clientOpts);
  }

  async send(systemPrompt: string, messages: Message[], tools?: ToolDef[]): Promise<NormalizedResponse> {
    const formatted = this.formatAnthropicMessages(messages);
    const toolSchemas = this.formatAnthropicTools(tools);

    const requestParams: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens ?? 4096,
      ...this.getReasoningParams(),
      ...(toolSchemas ? { tools: toolSchemas } : {}),
    };

    // System prompt: no cache_control on third-party endpoints
    if (!this.quirks.noCaching && !this.quirks.isThirdPartyAnthropic) {
      requestParams.system = [{
        type: "text" as const,
        text: systemPrompt,
        cache_control: { type: "ephemeral" as const },
      }];
      const messagesWithCache = this.applyCacheMarkers(formatted);
      requestParams.messages = messagesWithCache;
    } else {
      requestParams.system = systemPrompt;
      requestParams.messages = formatted;
    }

    const resp = await this.client.messages.create(
      requestParams as Anthropic.MessageCreateParams,
    );

    return this.parseResponse(resp.content, resp.usage, resp.stop_reason);
  }

  async sendStream(
    systemPrompt: string,
    messages: Message[],
    onToken: (token: string) => void,
    tools?: ToolDef[],
  ): Promise<NormalizedResponse> {
    const formatted = this.formatAnthropicMessages(messages);
    const toolSchemas = this.formatAnthropicTools(tools);

    const requestParams: Record<string, unknown> = {
      model: this.config.model,
      max_tokens: this.config.maxTokens ?? 4096,
      ...this.getReasoningParams(),
      ...(toolSchemas ? { tools: toolSchemas } : {}),
    };

    if (!this.quirks.noCaching && !this.quirks.isThirdPartyAnthropic) {
      requestParams.system = [{
        type: "text" as const,
        text: systemPrompt,
        cache_control: { type: "ephemeral" as const },
      }];
      const messagesWithCache = this.applyCacheMarkers(formatted);
      requestParams.messages = messagesWithCache;
    } else {
      requestParams.system = systemPrompt;
      requestParams.messages = formatted;
    }

    const stream = this.client.messages.stream(
      requestParams as Anthropic.MessageCreateParams,
    );

    let content = "";

    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          content += event.delta.text;
          onToken(event.delta.text);
        }
      }
    }

    const finalMessage = await stream.finalMessage();

    const toolCalls: ToolCall[] = [];
    for (const block of finalMessage.content) {
      if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: finalMessage.usage.input_tokens,
        completionTokens: finalMessage.usage.output_tokens,
        totalTokens: finalMessage.usage.input_tokens + finalMessage.usage.output_tokens,
      },
      finishReason: finalMessage.stop_reason ?? "end_turn",
    };
  }

  private formatAnthropicTools(tools?: ToolDef[]): Array<{ name: string; description: string; input_schema: Record<string, unknown> }> | undefined {
    if (!tools || tools.length === 0) return undefined;

    // Deduplicate tool names (Anthropic rejects duplicates)
    const seen = new Set<string>();
    const deduped = tools.filter(t => {
      if (seen.has(t.name)) return false;
      seen.add(t.name);
      return true;
    });

    return deduped.map((t) => {
      const schema = { type: "object" as const, ...t.parameters };
      // Strip nullable union patterns that Anthropic rejects
      // (anyOf: [{type: string}, {type: null}] → just the non-null type)
      const cleaned = this.stripNullableUnions(schema);
      return {
        name: t.name,
        description: t.description,
        input_schema: cleaned,
      };
    });
  }

  /** Strip `anyOf: [{type: X}, {type: null}]` patterns from tool schemas */
  private stripNullableUnions(schema: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema)) {
      if (key === "anyOf" && Array.isArray(value)) {
        const nonNull = (value as Array<Record<string, unknown>>).filter(
          (v: Record<string, unknown>) => v.type !== "null" && v.type !== undefined,
        );
        if (nonNull.length === 1) {
          // Spread all properties from the non-null variant, not just type
          Object.assign(result, this.stripNullableUnions(nonNull[0]));
          continue;
        }
        if (nonNull.length > 1) {
          result.anyOf = nonNull;
          continue;
        }
      }
      if (typeof value === "object" && value !== null && !Array.isArray(value)) {
        result[key] = this.stripNullableUnions(value as Record<string, unknown>);
      } else if (Array.isArray(value)) {
        result[key] = value.map(v =>
          typeof v === "object" && v !== null && !Array.isArray(v)
            ? this.stripNullableUnions(v as Record<string, unknown>)
            : v,
        );
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  private formatAnthropicMessages(messages: Message[]): Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }> {
    const result: Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }> = [];

    for (const m of messages) {
      if (m.role === "system") {
        // Anthropic doesn't support system role in messages array — convert to user
        result.push({ role: "user", content: `[System]: ${safeContent}` });
        continue;
      }

      // Sanitize content: Anthropic rejects empty strings
      const safeContent = m.content || "(empty message)";

      // Sanitize tool call IDs: only [a-zA-Z0-9_-] allowed
      const sanitizeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_");

      if (m.role === "assistant") {
        const blocks: Array<Record<string, unknown>> = [];
        if (safeContent) blocks.push({ type: "text", text: safeContent });
        if (m.toolCalls) {
          for (const tc of m.toolCalls) {
            blocks.push({ type: "tool_use", id: sanitizeId(tc.id), name: tc.name, input: tc.arguments });
          }
        }
        result.push({
          role: "assistant",
          content: blocks.length === 1 && blocks[0].type === "text" ? safeContent : blocks,
        });
      } else if (m.role === "tool") {
        const toolResult: Record<string, unknown> = {
          type: "tool_result",
          tool_use_id: sanitizeId(m.toolCallId ?? ""),
          content: safeContent,
        };
        // Merge consecutive tool results into one user message
        const last = result[result.length - 1];
        if (last && last.role === "user") {
          if (typeof last.content === "string") {
            last.content = [{ type: "text", text: last.content }, toolResult];
          } else {
            (last.content as Array<Record<string, unknown>>).push(toolResult);
          }
        } else {
          result.push({ role: "user", content: [toolResult] });
        }
      } else {
        result.push({ role: "user", content: safeContent });
      }
    }

    // Enforce strict role alternation: merge consecutive same-role messages
    return this.enforceRoleAlternation(result);
  }

  /** Enforce strict user/assistant alternation (Anthropic requirement) */
  private enforceRoleAlternation(
    messages: Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }>,
  ): Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }> {
    const result: Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }> = [];

    for (const m of messages) {
      const last = result[result.length - 1];
      if (last && last.role === m.role) {
        // Merge into same message
        if (typeof last.content === "string" && typeof m.content === "string") {
          last.content = last.content + "\n" + m.content;
        } else {
          const lastBlocks = typeof last.content === "string"
            ? [{ type: "text", text: last.content }]
            : [...last.content as Array<Record<string, unknown>>];
          const newBlocks = typeof m.content === "string"
            ? [{ type: "text", text: m.content }]
            : [...m.content as Array<Record<string, unknown>>];
          last.content = [...lastBlocks, ...newBlocks];
        }
      } else {
        result.push({ ...m });
      }
    }

    // Ensure starts with user role
    if (result.length > 0 && result[0].role !== "user") {
      result.unshift({ role: "user", content: "(conversation start)" });
    }

    return result;
  }

  /** Apply cache_control markers to the last 3 messages for prompt caching */
  private applyCacheMarkers(
    messages: Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }>,
  ): Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }> {
    if (messages.length === 0) return messages;

    return messages.map((m, i) => {
      const isLast3 = i >= messages.length - 3;
      if (!isLast3) return m;

      if (typeof m.content === "string") {
        return {
          role: m.role,
          content: [
            { type: "text", text: m.content, cache_control: { type: "ephemeral" as const } },
          ],
        };
      }

      const blocks = [...(m.content as Array<Record<string, unknown>>)];
      if (blocks.length > 0) {
        blocks[blocks.length - 1] = {
          ...blocks[blocks.length - 1],
          cache_control: { type: "ephemeral" as const },
        };
      }
      return { role: m.role, content: blocks };
    });
  }

  private parseResponse(
    content: Anthropic.ContentBlock[],
    usage: Anthropic.Usage,
    stopReason: string | null,
  ): NormalizedResponse {
    let text = "";
    const toolCalls: ToolCall[] = [];

    for (const block of content) {
      if (block.type === "text") text += block.text;
      else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, unknown>,
        });
      }
      // Skip signed/redacted thinking blocks on third-party endpoints
      // (they are Anthropic-proprietary and cause errors on MiniMax etc.)
    }

    return {
      content: text,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens: usage.input_tokens,
        completionTokens: usage.output_tokens,
        totalTokens: usage.input_tokens + usage.output_tokens,
      },
      finishReason: stopReason ?? "end_turn",
    };
  }

  private getReasoningParams(): Record<string, unknown> {
    const effort = this.config.reasoningEffort;
    if (!effort) return {};

    // Third-party endpoints: skip reasoning params
    if (this.quirks.isThirdPartyAnthropic) return {};

    const budgetMap: Record<string, number> = { low: 2000, medium: 10000, high: 32000 };
    const budget = budgetMap[effort] ?? 10000;
    return {
      thinking: { type: "enabled", budget_tokens: budget },
    };
  }

  /** Infer quirks from provider name in LLMConfig */
  private inferQuirks(): ProviderQuirks {
    if (!this.config.provider) return {};
    const profile = findProvider(this.config.provider);
    return profile?.quirks ?? {};
  }

  getConfig() { return this.config; }
}
