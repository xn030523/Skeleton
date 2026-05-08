import type { AgentConfig, Message, NormalizedResponse } from "./types.js";
import { ChatCompletionsTransport } from "./transports/chat-completions.js";
import { AnthropicTransport } from "./transports/anthropic.js";
import type { Transport } from "./transports/base.js";
import { ToolRegistry } from "./tools/registry.js";
import type { MemoryStore } from "./memory/index.js";

export class Agent {
  private transport: Transport;
  private fallbackTransport: Transport | null;
  private messages: Message[] = [];
  private toolRegistry: ToolRegistry;
  private maxTurns: number;
  private basePrompt: string;
  private memory: MemoryStore | null;

  constructor(config: AgentConfig, memory?: MemoryStore) {
    this.transport = this.createTransport(config.llm);
    this.fallbackTransport = config.fallback ? this.createTransport(config.fallback) : null;
    this.toolRegistry = new ToolRegistry(config.tools ?? []);
    this.maxTurns = config.maxTurns ?? 20;
    this.basePrompt = config.systemPrompt ?? "You are Skeleton, a reverse engineering AI assistant.";
    this.memory = memory ?? null;
  }

  private createTransport(llm: AgentConfig["llm"]): Transport {
    if (llm.protocol === "anthropic") return new AnthropicTransport(llm);
    return new ChatCompletionsTransport(llm);
  }

  private buildSystemPrompt(): string {
    let prompt = this.basePrompt;
    if (this.memory) {
      const memCtx = this.memory.buildContext();
      if (memCtx) prompt += `\n\n${memCtx}`;
    }
    return prompt;
  }

  async run(userInput: string): Promise<string> {
    this.messages.push({ role: "user", content: userInput });
    const systemPrompt = this.buildSystemPrompt();

    for (let turn = 0; turn < this.maxTurns; turn++) {
      const response = await this.callWithFallback(systemPrompt);
      if (!this.handleResponse(response)) return response.content;
    }
    return "[max turns reached]";
  }

  async runStream(userInput: string, onToken: (token: string) => void): Promise<string> {
    this.messages.push({ role: "user", content: userInput });
    const systemPrompt = this.buildSystemPrompt();

    for (let turn = 0; turn < this.maxTurns; turn++) {
      const response = await this.streamWithFallback(systemPrompt, onToken);
      if (!this.handleResponse(response)) return response.content;
    }
    return "[max turns reached]";
  }

  private handleResponse(response: NormalizedResponse): boolean {
    if (response.toolCalls && response.toolCalls.length > 0) {
      this.messages.push({
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
      });
      for (const tc of response.toolCalls) {
        const result = this.toolRegistry.execute(tc.name, tc.arguments);
        this.messages.push({
          role: "tool",
          content: typeof result === "string" ? result : JSON.stringify(result),
          toolCallId: tc.id,
        });
      }
      return true; // continue loop
    }

    if (this.memory && response.content) {
      this.autoSaveMemory(response.content);
    }
    this.messages.push({ role: "assistant", content: response.content });
    return false; // done
  }

  private autoSaveMemory(content: string): void {
    if (!this.memory) return;
    const keywords = [
      "vulnerability", "exploit", "offset", "address", "function",
      "漏洞", "偏移", "地址", "函数", "算法", "密钥", "加密",
      "key", "algorithm", "decrypt", "encrypt", "hash",
      "struct", "protocol", "format", "header",
    ];
    const lines = content.split("\n").filter((l) => l.trim().length > 10);
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (keywords.some((kw) => lower.includes(kw))) {
          this.memory.add(line.trim(), "finding", "auto");
        }
    }
  }

  private async callWithFallback(systemPrompt: string): Promise<NormalizedResponse> {
    let lastErr: unknown;
    try {
      return await this.transport.send(systemPrompt, this.messages);
    } catch (err) {
      lastErr = err;
      if (this.fallbackTransport) {
        try { return await this.fallbackTransport.send(systemPrompt, this.messages); } catch (err2) { lastErr = err2; }
      }
      throw new Error(`All providers failed: ${(lastErr as Error)?.message ?? lastErr}`);
    }
  }

  private async streamWithFallback(
    systemPrompt: string,
    onToken: (token: string) => void,
  ): Promise<NormalizedResponse> {
    let lastErr: unknown;
    try {
      return await this.transport.sendStream(systemPrompt, this.messages, onToken);
    } catch (err) {
      lastErr = err;
      if (this.fallbackTransport) {
        try { return await this.fallbackTransport.sendStream(systemPrompt, this.messages, onToken); } catch (err2) { lastErr = err2; }
      }
      throw new Error(`All providers failed: ${(lastErr as Error)?.message ?? lastErr}`);
    }
  }

  getHistory(): Message[] { return [...this.messages]; }
  reset(): void { this.messages = []; }
}
