import OpenAI from "openai";
import type { Transport } from "./base.js";
import type { LLMConfig, Message, NormalizedResponse, ToolCall, ToolDef } from "../types.js";
import type { ProviderQuirks } from "../providers/registry.js";
import { findProvider } from "../providers/registry.js";

export interface ChatCompletionsTransportOptions {
  quirks?: ProviderQuirks;
}

export class ChatCompletionsTransport implements Transport {
  private client: OpenAI;
  private quirks: ProviderQuirks;

  constructor(private config: LLMConfig, options?: ChatCompletionsTransportOptions) {
    this.quirks = options?.quirks ?? this.inferQuirks();

    const clientOpts: OpenAI.ClientOptions = {
      apiKey: config.apiKey || (this.quirks.skipApiKey ? "sk-no-key-required" : undefined),
      baseURL: config.baseUrl,
    };

    // Azure uses api-key header instead of Authorization: Bearer
    if (this.quirks.authMode === "api-key") {
      clientOpts.defaultHeaders = {
        ...clientOpts.defaultHeaders,
        "api-key": config.apiKey,
      };
    }

    // Custom headers from provider quirks (Kimi User-Agent, OpenRouter referer, etc.)
    if (this.quirks.customHeaders) {
      clientOpts.defaultHeaders = {
        ...clientOpts.defaultHeaders,
        ...this.quirks.customHeaders,
      };
    }

    this.client = new OpenAI(clientOpts);
  }

  async send(systemPrompt: string, messages: Message[], tools?: ToolDef[]): Promise<NormalizedResponse> {
    const formatted = this.formatMessages(systemPrompt, messages);
    const toolSchemas = this.formatOpenAITools(tools);

    const resp = await this.client.chat.completions.create({
      model: this.config.model,
      messages: formatted,
      max_tokens: this.config.maxTokens ?? 4096,
      temperature: this.config.temperature ?? 0.3,
      ...(this.config.reasoningEffort ? { reasoning_effort: this.config.reasoningEffort } : {}),
      ...(toolSchemas ? { tools: toolSchemas } : {}),
    });

    const choice = resp.choices[0];
    const toolCalls = this.parseToolCalls(choice.message?.tool_calls);

    return {
      content: choice.message?.content ?? "",
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: resp.usage
        ? {
            promptTokens: resp.usage.prompt_tokens,
            completionTokens: resp.usage.completion_tokens,
            totalTokens: resp.usage.total_tokens,
          }
        : undefined,
      finishReason: choice.finish_reason ?? "stop",
    };
  }

  async sendStream(
    systemPrompt: string,
    messages: Message[],
    onToken: (token: string) => void,
    tools?: ToolDef[],
  ): Promise<NormalizedResponse> {
    const formatted = this.formatMessages(systemPrompt, messages);
    const toolSchemas = this.formatOpenAITools(tools);

    const stream = await this.client.chat.completions.create({
      model: this.config.model,
      messages: formatted,
      max_tokens: this.config.maxTokens ?? 4096,
      temperature: this.config.temperature ?? 0.3,
      stream: true,
      stream_options: { include_usage: true },
      ...(this.config.reasoningEffort ? { reasoning_effort: this.config.reasoningEffort } : {}),
      ...(toolSchemas ? { tools: toolSchemas } : {}),
    });

    let content = "";
    const toolCallBuffers: Map<number, { id: string; name: string; args: string }> = new Map();
    let streamUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      if (delta?.content) {
        content += delta.content;
        onToken(delta.content);
      }

      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          if (!toolCallBuffers.has(idx)) {
            toolCallBuffers.set(idx, { id: tc.id ?? "", name: "", args: "" });
          }
          const buf = toolCallBuffers.get(idx)!;
          if (tc.id) buf.id = tc.id;
          if (tc.function?.name) buf.name = tc.function.name;
          if (tc.function?.arguments) buf.args += tc.function.arguments;
        }
      }

      // Extract usage from final chunk (OpenAI sends usage in last chunk with stream_options)
      if (chunk.usage) {
        streamUsage = {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        };
      }
    }

    const toolCalls: ToolCall[] = [...toolCallBuffers.values()].map((buf) => ({
      id: buf.id,
      name: buf.name,
      arguments: JSON.parse(buf.args || "{}"),
    }));

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: streamUsage,
      finishReason: "stop",
    };
  }

  private formatOpenAITools(tools?: ToolDef[]): Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }> | undefined {
    if (!tools || tools.length === 0) return undefined;

    // Deduplicate tool names (some endpoints reject duplicates)
    const seen = new Set<string>();
    const deduped = tools.filter(t => {
      if (seen.has(t.name)) return false;
      seen.add(t.name);
      return true;
    });

    return deduped.map((t) => ({
      type: "function" as const,
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));
  }

  private formatMessages(systemPrompt: string, messages: Message[]) {
    return [
      { role: "system" as const, content: systemPrompt },
      ...messages.map((m) => {
        const base: Record<string, unknown> = {
          role: m.role as "user" | "assistant" | "tool",
          content: m.content || "(empty message)",
        };
        if (m.role === "assistant" && m.toolCalls) {
          base.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function" as const,
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          }));
        }
        if (m.role === "tool" && m.toolCallId) {
          base.tool_call_id = m.toolCallId;
        }
        return base;
      }),
    ];
  }

  private parseToolCalls(raw?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]): ToolCall[] {
    return (raw ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));
  }

  /** Infer quirks from provider name in LLMConfig */
  private inferQuirks(): ProviderQuirks {
    if (!this.config.provider) return {};
    const profile = findProvider(this.config.provider);
    return profile?.quirks ?? {};
  }

  getConfig() { return this.config; }
}
