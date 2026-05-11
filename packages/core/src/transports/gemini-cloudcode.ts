/**
 * Gemini CloudCode Transport — Google Cloud Vertex AI endpoint.
 *
 * Different from Gemini Native (AI Studio) — this uses Vertex AI's enterprise
 * endpoint with project + location + publisher path structure:
 *   https://{location}-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models/{model}:streamGenerateContent
 *
 * Auth: OAuth 2.0 Bearer token (from gcloud auth) or service account JWT.
 * Requires SKELETON_GCP_PROJECT + SKELETON_GCP_LOCATION (or config.project/location).
 */

import type { Transport } from "./base.js";
import type { LLMConfig, Message, NormalizedResponse, ToolCall, ToolDef } from "../types.js";

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args: Record<string, unknown> };
  functionResponse?: { name: string; response: { content: string } };
}

interface GeminiContent {
  role: "user" | "model";
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

export class GeminiCloudCodeTransport implements Transport {
  private project: string;
  private location: string;
  private accessToken: string;
  private model: string;
  private maxTokens: number;
  private temperature: number;

  constructor(private config: LLMConfig) {
    this.project = (config as any).project ?? process.env.SKELETON_GCP_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? "";
    this.location = (config as any).location ?? process.env.SKELETON_GCP_LOCATION ?? process.env.GOOGLE_CLOUD_LOCATION ?? "us-central1";
    this.accessToken = config.apiKey; // Expect OAuth access token
    this.model = config.model;
    this.maxTokens = config.maxTokens ?? 4096;
    this.temperature = config.temperature ?? 0.3;

    if (!this.project) {
      throw new Error("Gemini CloudCode requires a GCP project ID. Set SKELETON_GCP_PROJECT or config.project.");
    }
  }

  private buildUrl(streaming: boolean): string {
    const method = streaming ? "streamGenerateContent" : "generateContent";
    return `https://${this.location}-aiplatform.googleapis.com/v1/projects/${this.project}/locations/${this.location}/publishers/google/models/${this.model}:${method}${streaming ? "?alt=sse" : ""}`;
  }

  async send(systemPrompt: string, messages: Message[], tools?: ToolDef[]): Promise<NormalizedResponse> {
    const body = this.buildRequestBody(systemPrompt, messages, tools);
    const resp = await fetch(this.buildUrl(false), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => "");
      throw new Error(`Vertex AI error (${resp.status}): ${err}`);
    }

    const data = await resp.json() as GeminiResponse;
    return this.parseResponse(data);
  }

  async sendStream(
    systemPrompt: string,
    messages: Message[],
    onToken: (token: string) => void,
    tools?: ToolDef[],
  ): Promise<NormalizedResponse> {
    const body = this.buildRequestBody(systemPrompt, messages, tools);
    const resp = await fetch(this.buildUrl(true), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.accessToken}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const err = await resp.text().catch(() => "");
      throw new Error(`Vertex AI streaming error (${resp.status}): ${err}`);
    }

    let content = "";
    const toolCalls: ToolCall[] = [];
    let promptTokens = 0;
    let completionTokens = 0;

    const reader = resp.body?.getReader();
    if (!reader) throw new Error("No response body for streaming");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;

        try {
          const chunk = JSON.parse(jsonStr) as GeminiResponse;
          const candidate = chunk.candidates?.[0];
          if (!candidate?.content?.parts) continue;

          for (const part of candidate.content.parts) {
            if (part.text) {
              content += part.text;
              onToken(part.text);
            }
            if (part.functionCall) {
              toolCalls.push({
                id: `vertex_${Date.now()}_${toolCalls.length}`,
                name: part.functionCall.name,
                arguments: part.functionCall.args ?? {},
              });
            }
          }

          if (chunk.usageMetadata) {
            promptTokens = chunk.usageMetadata.promptTokenCount ?? 0;
            completionTokens = chunk.usageMetadata.candidatesTokenCount ?? 0;
          }
        } catch { /* skip */ }
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      finishReason: "stop",
    };
  }

  private buildRequestBody(systemPrompt: string, messages: Message[], tools?: ToolDef[]) {
    const contents = this.formatContents(messages);
    const body: Record<string, unknown> = {
      contents,
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        maxOutputTokens: this.maxTokens,
        temperature: this.temperature,
      },
    };

    if (tools && tools.length > 0) {
      body.tools = [{
        functionDeclarations: tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        })),
      }];
    }

    return body;
  }

  private formatContents(messages: Message[]): GeminiContent[] {
    const contents: GeminiContent[] = [];
    for (const m of messages) {
      if (m.role === "system") continue;

      if (m.role === "user") {
        contents.push({ role: "user", parts: [{ text: m.content || "(empty)" }] });
      } else if (m.role === "assistant") {
        const parts: GeminiPart[] = [];
        if (m.content) parts.push({ text: m.content });
        if (m.toolCalls) {
          for (const tc of m.toolCalls) {
            parts.push({ functionCall: { name: tc.name, args: tc.arguments } });
          }
        }
        if (parts.length === 0) parts.push({ text: "(empty)" });
        contents.push({ role: "model", parts });
      } else if (m.role === "tool") {
        contents.push({
          role: "user",
          parts: [{
            functionResponse: {
              name: m.toolCallId ?? "unknown",
              response: { content: m.content },
            },
          }],
        });
      }
    }
    return contents;
  }

  private parseResponse(data: GeminiResponse): NormalizedResponse {
    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts) return { content: "", finishReason: "stop" };

    let content = "";
    const toolCalls: ToolCall[] = [];

    for (const part of candidate.content.parts) {
      if (part.text) content += part.text;
      if (part.functionCall) {
        toolCalls.push({
          id: `vertex_${Date.now()}_${toolCalls.length}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args ?? {},
        });
      }
    }

    return {
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: data.usageMetadata ? {
        promptTokens: data.usageMetadata.promptTokenCount ?? 0,
        completionTokens: data.usageMetadata.candidatesTokenCount ?? 0,
        totalTokens: (data.usageMetadata.promptTokenCount ?? 0) + (data.usageMetadata.candidatesTokenCount ?? 0),
      } : undefined,
      finishReason: candidate.finishReason ?? "stop",
    };
  }

  getConfig() { return this.config; }
}
