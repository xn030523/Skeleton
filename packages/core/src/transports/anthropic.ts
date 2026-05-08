import Anthropic from "@anthropic-ai/sdk";
import type { Transport } from "./base.js";
import type { LLMConfig, Message, NormalizedResponse, ToolCall, ToolDef } from "../types.js";

export class AnthropicTransport implements Transport {
  private client: Anthropic;

  constructor(private config: LLMConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  async send(systemPrompt: string, messages: Message[], tools?: ToolDef[]): Promise<NormalizedResponse> {
    const formatted = this.formatAnthropicMessages(messages);
    const toolSchemas = this.formatAnthropicTools(tools);

    // Apply cache_control breakpoints: system prompt + last 3 non-system messages
    const systemWithCache = {
      type: "text" as const,
      text: systemPrompt,
      cache_control: { type: "ephemeral" as const },
    };

    const messagesWithCache = this.applyCacheMarkers(formatted);

    const resp = await this.client.messages.create({
      model: this.config.model,
      system: [systemWithCache],
      messages: messagesWithCache,
      max_tokens: this.config.maxTokens ?? 4096,
      ...this.getReasoningParams(),
      ...(toolSchemas ? { tools: toolSchemas } : {}),
    });

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

    const systemWithCache = {
      type: "text" as const,
      text: systemPrompt,
      cache_control: { type: "ephemeral" as const },
    };

    const messagesWithCache = this.applyCacheMarkers(formatted);

    const stream = this.client.messages.stream({
      model: this.config.model,
      system: [systemWithCache],
      messages: messagesWithCache,
      max_tokens: this.config.maxTokens ?? 4096,
      ...this.getReasoningParams(),
      ...(toolSchemas ? { tools: toolSchemas } : {}),
    });

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
    return tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: {
        type: "object" as const,
        ...t.parameters,
      },
    }));
  }

  private formatAnthropicMessages(messages: Message[]): Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }> {
    const result: Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }> = [];

    for (const m of messages) {
      if (m.role === "system") continue;

      if (m.role === "assistant") {
        const blocks: Array<Record<string, unknown>> = [];
        if (m.content) blocks.push({ type: "text", text: m.content });
        if (m.toolCalls) {
          for (const tc of m.toolCalls) {
            blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
          }
        }
        result.push({
          role: "assistant",
          content: blocks.length === 1 && blocks[0].type === "text" ? m.content : blocks,
        });
      } else if (m.role === "tool") {
        const toolResult: Record<string, unknown> = {
          type: "tool_result",
          tool_use_id: m.toolCallId!,
          content: m.content,
        };
        // Merge consecutive tool results into one user message (Anthropic requirement)
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
        result.push({ role: "user", content: m.content });
      }
    }

    return result;
  }

  /** Apply cache_control markers to the last 3 messages for prompt caching */
  private applyCacheMarkers(
    messages: Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }>,
  ): Array<{ role: "user" | "assistant"; content: string | Array<Record<string, unknown>> }> {
    if (messages.length === 0) return messages;

    const result = messages.map((m, i) => {
      const isLast3 = i >= messages.length - 3;
      if (!isLast3) return m;

      // Only add cache_control to messages that have array content blocks
      if (typeof m.content === "string") {
        return {
          role: m.role,
          content: [
            { type: "text", text: m.content, cache_control: { type: "ephemeral" as const } },
          ],
        };
      }

      // Array content: add cache_control to the last block
      const blocks = [...(m.content as Array<Record<string, unknown>>)];
      if (blocks.length > 0) {
        blocks[blocks.length - 1] = {
          ...blocks[blocks.length - 1],
          cache_control: { type: "ephemeral" as const },
        };
      }
      return { role: m.role, content: blocks };
    });

    return result;
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

  private getReasoningParams(): Record<string, unknown> {
    const effort = this.config.reasoningEffort;
    if (!effort) return {};
    const budgetMap: Record<string, number> = { low: 2000, medium: 10000, high: 32000 };
    const budget = budgetMap[effort] ?? 10000;
    return {
      thinking: { type: "enabled", budget_tokens: budget },
    };
  }

  getConfig() { return this.config; }
}
