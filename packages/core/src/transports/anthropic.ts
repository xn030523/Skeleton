import Anthropic from "@anthropic-ai/sdk";
import type { Transport } from "./base.js";
import type { LLMConfig, Message, NormalizedResponse, ToolCall } from "../types.js";

export class AnthropicTransport implements Transport {
  private client: Anthropic;

  constructor(private config: LLMConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  async send(systemPrompt: string, messages: Message[]): Promise<NormalizedResponse> {
    const filtered = this.filterMessages(messages);

    const resp = await this.client.messages.create({
      model: this.config.model,
      system: systemPrompt,
      messages: filtered,
      max_tokens: this.config.maxTokens ?? 4096,
    });

    return this.parseResponse(resp.content, resp.usage, resp.stop_reason);
  }

  async sendStream(
    systemPrompt: string,
    messages: Message[],
    onToken: (token: string) => void,
  ): Promise<NormalizedResponse> {
    const filtered = this.filterMessages(messages);

    const stream = this.client.messages.stream({
      model: this.config.model,
      system: systemPrompt,
      messages: filtered,
      max_tokens: this.config.maxTokens ?? 4096,
    });

    let content = "";
    const toolCallBuffers: Map<string, { name: string; input: string }> = new Map();

    for await (const event of stream) {
      if (event.type === "content_block_delta") {
        if (event.delta.type === "text_delta") {
          content += event.delta.text;
          onToken(event.delta.text);
        } else if (event.delta.type === "input_json_delta") {
          // tool use partial input — we don't stream these as tokens
        }
      } else if (event.type === "content_block_start") {
        if (event.content_block.type === "tool_use") {
          toolCallBuffers.set(event.content_block.id, {
            name: event.content_block.name,
            input: "",
          });
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

  private filterMessages(messages: Message[]): Array<{ role: "user" | "assistant"; content: string }> {
    return messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      }));
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
}
