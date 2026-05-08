import OpenAI from "openai";
import type { Transport } from "./base.js";
import type { LLMConfig, Message, NormalizedResponse, ToolCall } from "../types.js";

export class ChatCompletionsTransport implements Transport {
  private client: OpenAI;

  constructor(private config: LLMConfig) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: `${config.baseUrl}/v1`,
    });
  }

  async send(systemPrompt: string, messages: Message[]): Promise<NormalizedResponse> {
    const formatted = this.formatMessages(systemPrompt, messages);

    const resp = await this.client.chat.completions.create({
      model: this.config.model,
      messages: formatted,
      max_tokens: this.config.maxTokens ?? 4096,
      temperature: this.config.temperature ?? 0.3,
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
  ): Promise<NormalizedResponse> {
    const formatted = this.formatMessages(systemPrompt, messages);

    const stream = await this.client.chat.completions.create({
      model: this.config.model,
      messages: formatted,
      max_tokens: this.config.maxTokens ?? 4096,
      temperature: this.config.temperature ?? 0.3,
      stream: true,
    });

    let content = "";
    const toolCallBuffers: Map<number, { id: string; name: string; args: string }> = new Map();

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
    }

    const toolCalls: ToolCall[] = [...toolCallBuffers.values()].map((buf) => ({
      id: buf.id,
      name: buf.name,
      arguments: JSON.parse(buf.args || "{}"),
    }));

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: "stop",
    };
  }

  private formatMessages(systemPrompt: string, messages: Message[]) {
    return [
      { role: "system" as const, content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role as "user" | "assistant" | "tool",
        content: m.content,
        ...(m.role === "assistant" && m.toolCalls ? { tool_calls: m.toolCalls } : {}),
        ...(m.role === "tool" && m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
      })),
    ];
  }

  private parseToolCalls(raw?: OpenAI.Chat.Completions.ChatCompletionMessageToolCall[]): ToolCall[] {
    return (raw ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments),
    }));
  }
}
