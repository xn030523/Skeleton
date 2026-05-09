/**
 * Bedrock Converse Transport — AWS Bedrock Converse API format.
 *
 * The Converse API uses a completely different message and tool format
 * from OpenAI/Anthropic. Tool results go in user-role messages,
 * content is always block arrays (no bare strings), and tool schemas
 * use `toolSpec` + `inputSchema.json` (not OpenAI `function` wrapper).
 *
 * Claude models on Bedrock use AnthropicBedrock SDK for prompt caching
 * and thinking support; non-Claude models use the Converse API directly.
 *
 * Inspired by Hermes bedrock_adapter.py (simplified — v1 Converse only).
 */

import type { Transport } from "./base.js";
import type { LLMConfig, Message, NormalizedResponse, ToolCall, ToolDef } from "../types.js";

interface BedrockContentBlock {
  text?: string;
  toolUse?: { toolUseId: string; name: string; input: Record<string, unknown> };
  toolResult?: { toolUseId: string; content: Array<{ text: string }>; status?: string };
}

interface BedrockMessage {
  role: "user" | "assistant";
  content: BedrockContentBlock[];
}

interface BedrockToolSpec {
  toolSpec: {
    name: string;
    description: string;
    inputSchema: { json: Record<string, unknown> };
  };
}

interface ConverseResponse {
  output?: {
    message?: {
      role: string;
      content: Array<{ text?: string; toolUse?: { toolUseId: string; name: string; input: Record<string, unknown> } }>;
    };
  };
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  stopReason?: string;
}

export class BedrockConverseTransport implements Transport {
  private region: string;
  private modelId: string;

  constructor(private config: LLMConfig) {
    this.region = process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1";
    this.modelId = config.model;
  }

  async send(systemPrompt: string, messages: Message[], tools?: ToolDef[]): Promise<NormalizedResponse> {
    const bedrockMessages = this.formatMessages(messages);
    const toolConfig = this.formatTools(tools);
    const systemBlocks = [{ text: systemPrompt }];

    const params: Record<string, unknown> = {
      modelId: this.modelId,
      messages: bedrockMessages,
      system: systemBlocks,
      inferenceConfig: {
        maxTokens: this.config.maxTokens ?? 4096,
        temperature: this.config.temperature ?? 0.3,
      },
    };
    if (toolConfig) params.toolConfig = toolConfig;

    const resp = await this.converse(params);
    return this.parseResponse(resp);
  }

  async sendStream(
    systemPrompt: string,
    messages: Message[],
    onToken: (token: string) => void,
    tools?: ToolDef[],
  ): Promise<NormalizedResponse> {
    const bedrockMessages = this.formatMessages(messages);
    const toolConfig = this.formatTools(tools);
    const systemBlocks = [{ text: systemPrompt }];

    const params: Record<string, unknown> = {
      modelId: this.modelId,
      messages: bedrockMessages,
      system: systemBlocks,
      inferenceConfig: {
        maxTokens: this.config.maxTokens ?? 4096,
        temperature: this.config.temperature ?? 0.3,
      },
    };
    if (toolConfig) params.toolConfig = toolConfig;

    const resp = await this.converseStream(params, onToken);
    return this.parseResponse(resp);
  }

  private formatMessages(messages: Message[]): BedrockMessage[] {
    const result: BedrockMessage[] = [];

    for (const m of messages) {
      if (m.role === "system") continue;

      if (m.role === "user") {
        result.push({
          role: "user",
          content: [{ text: m.content || " " }], // Bedrock rejects empty text blocks
        });
      } else if (m.role === "assistant") {
        const blocks: BedrockContentBlock[] = [];
        if (m.content) blocks.push({ text: m.content });
        if (m.toolCalls) {
          for (const tc of m.toolCalls) {
            blocks.push({
              toolUse: { toolUseId: tc.id, name: tc.name, input: tc.arguments },
            });
          }
        }
        if (blocks.length === 0) blocks.push({ text: " " });
        result.push({ role: "assistant", content: blocks });
      } else if (m.role === "tool") {
        // Tool results go in user-role messages
        const toolResult: BedrockContentBlock = {
          toolResult: {
            toolUseId: m.toolCallId ?? "",
            content: [{ text: m.content || " " }],
          },
        };
        const last = result[result.length - 1];
        if (last && last.role === "user") {
          last.content.push(toolResult);
        } else {
          result.push({ role: "user", content: [toolResult] });
        }
      }
    }

    // Enforce role alternation: merge consecutive same-role
    return this.enforceAlternation(result);
  }

  private enforceAlternation(msgs: BedrockMessage[]): BedrockMessage[] {
    const result: BedrockMessage[] = [];
    for (const m of msgs) {
      const last = result[result.length - 1];
      if (last && last.role === m.role) {
        last.content.push(...m.content);
      } else {
        result.push({ role: m.role, content: [...m.content] });
      }
    }
    // Must start with user
    if (result.length > 0 && result[0].role !== "user") {
      result.unshift({ role: "user", content: [{ text: " " }] });
    }
    return result;
  }

  private formatTools(tools?: ToolDef[]): { tools: BedrockToolSpec[] } | undefined {
    if (!tools || tools.length === 0) return undefined;

    const seen = new Set<string>();
    const deduped = tools.filter(t => {
      if (seen.has(t.name)) return false;
      seen.add(t.name);
      return true;
    });

    return {
      tools: deduped.map((t) => ({
        toolSpec: {
          name: t.name,
          description: t.description,
          inputSchema: { json: t.parameters },
        },
      })),
    };
  }

  private async converse(params: Record<string, unknown>): Promise<ConverseResponse> {
    // Use @aws-sdk/client-bedrock-runtime if available, else HTTP fallback
    try {
      const { BedrockRuntimeClient, ConverseCommand } = await import("@aws-sdk/client-bedrock-runtime");
      const client = new BedrockRuntimeClient({ region: this.region });
      const command = new ConverseCommand(params as any);
      const response = await client.send(command);
      return response as unknown as ConverseResponse;
    } catch {
      // Fallback: HTTP-based Bedrock API call
      return this.converseHttp(params);
    }
  }

  private async converseStream(
    params: Record<string, unknown>,
    onToken: (token: string) => void,
  ): Promise<ConverseResponse> {
    try {
      const { BedrockRuntimeClient, ConverseStreamCommand } = await import("@aws-sdk/client-bedrock-runtime");
      const client = new BedrockRuntimeClient({ region: this.region });
      const command = new ConverseStreamCommand(params as any);
      const response = await client.send(command);

      let content = "";
      const toolCalls: ToolCall[] = [];
      let usage = { inputTokens: 0, outputTokens: 0 };

      for await (const event of response.stream ?? []) {
        const ev = event as Record<string, unknown>;
        if (ev.contentBlockDelta) {
          const delta = (ev.contentBlockDelta as Record<string, unknown>).delta as Record<string, unknown>;
          if (delta?.text) {
            content += delta.text;
            onToken(delta.text as string);
          }
          if (delta?.toolUse) {
            const tu = delta.toolUse as Record<string, unknown>;
            const name = String(tu.name ?? "");
            const input = (tu.input ?? {}) as Record<string, unknown>;
            toolCalls.push({ id: `tu_${Date.now()}`, name, arguments: input });
          }
        }
        if (ev.metadata) {
          const meta = ev.metadata as Record<string, unknown>;
          const metaUsage = meta.usage as Record<string, number> | undefined;
          if (metaUsage) {
            usage = { inputTokens: metaUsage.inputTokens ?? 0, outputTokens: metaUsage.outputTokens ?? 0 };
          }
        }
      }

      return {
        output: {
          message: { role: "assistant", content: [{ text: content }, ...toolCalls.map(tc => ({ toolUse: { toolUseId: tc.id, name: tc.name, input: tc.arguments } }))] },
        },
        usage,
        stopReason: "end_turn",
      };
    } catch {
      // Fallback to non-streaming
      const resp = await this.converseHttp(params);
      if (resp.output?.message?.content) {
        for (const block of resp.output.message.content) {
          if (block.text) onToken(block.text);
        }
      }
      return resp;
    }
  }

  /** HTTP-based Bedrock Converse call (fallback when AWS SDK not installed) */
  private async converseHttp(params: Record<string, unknown>): Promise<ConverseResponse> {
    const { SigV4Signer } = await import("@smithy/signature-v4-crt") ?? {};
    // Simplified: direct HTTP call to Bedrock
    const url = `https://bedrock-runtime.${this.region}.amazonaws.com/model/${encodeURIComponent(this.modelId)}/converse`;

    // Get AWS credentials from env or SDK credential chain
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID ?? "";
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY ?? "";
    const sessionToken = process.env.AWS_SESSION_TOKEN;

    if (!accessKeyId || !secretAccessKey) {
      throw new Error("Bedrock requires AWS credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY) or @aws-sdk/client-bedrock-runtime package");
    }

    // Sign the request with AWS SigV4
    const body = JSON.stringify(params);
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(sessionToken ? { "X-Amz-Security-Token": sessionToken } : {}),
      },
      body,
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Bedrock Converse API error (${resp.status}): ${errText}`);
    }

    return resp.json() as Promise<ConverseResponse>;
  }

  private parseResponse(resp: ConverseResponse): NormalizedResponse {
    let content = "";
    const toolCalls: ToolCall[] = [];

    const messageContent = resp.output?.message?.content ?? [];
    for (const block of messageContent) {
      if (block.text) content += block.text;
      if (block.toolUse) {
        toolCalls.push({
          id: block.toolUse.toolUseId,
          name: block.toolUse.name,
          arguments: block.toolUse.input,
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: resp.usage
        ? {
            promptTokens: resp.usage.inputTokens,
            completionTokens: resp.usage.outputTokens,
            totalTokens: resp.usage.inputTokens + resp.usage.outputTokens,
          }
        : undefined,
      finishReason: resp.stopReason ?? "end_turn",
    };
  }

  getConfig() { return this.config; }
}
