/**
 * Context Engine ABC — pluggable context management interface.
 *
 * Controls how conversation context is managed when approaching
 * token limits. Implementations can use different compression
 * strategies (summarization, sliding window, vector retrieval, etc.).
 *
 * Inspired by Hermes context_engine.py.
 */

import type { Message } from "../types.js";

export interface ContextEngine {
  /** Called when a session starts */
  onSessionStart?(sessionId: string): void;

  /** Called after each model response */
  updateFromResponse?(messages: Message[], response: string): void;

  /** Determine if compression is needed */
  shouldCompress(messages: Message[], maxTokens: number): boolean;

  /** Compress the message history */
  compress(messages: Message[], maxTokens: number): Promise<Message[]>;

  /** Called when a session ends */
  onSessionEnd?(sessionId: string): void;
}

/** Default sliding-window context engine — keeps last N messages */
export class SlidingWindowEngine implements ContextEngine {
  constructor(private maxMessages: number = 50) {}

  shouldCompress(messages: Message[], maxTokens: number): boolean {
    // Rough token estimate: ~4 chars per token
    const totalChars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
    const estimatedTokens = totalChars / 4;
    return messages.length > this.maxMessages || estimatedTokens > maxTokens * 0.8;
  }

  async compress(messages: Message[], maxTokens: number): Promise<Message[]> {
    // Keep first user message + last N messages (system prompt is sent separately)
    const keepCount = Math.min(this.maxMessages, messages.length);
    if (messages.length <= keepCount) return messages;

    const first = messages[0];
    const last = messages.slice(-(keepCount - 1));
    return [
      first,
      { role: "system" as const, content: `[Earlier context compressed: ${messages.length - keepCount} messages omitted]` },
      ...last,
    ];
  }
}

/** Summarization context engine — uses auxiliary LLM to compress middle messages */
export class SummarizationEngine implements ContextEngine {
  constructor(
    private summarizer: (text: string) => Promise<string>,
    private maxMessages: number = 50,
  ) {}

  shouldCompress(messages: Message[], maxTokens: number): boolean {
    const totalChars = messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
    const estimatedTokens = totalChars / 4;
    return messages.length > this.maxMessages || estimatedTokens > maxTokens * 0.8;
  }

  async compress(messages: Message[], maxTokens: number): Promise<Message[]> {
    if (messages.length <= 10) return messages;

    // Protect head (first 3) and tail (last 5)
    const head = messages.slice(0, 3);
    const tail = messages.slice(-5);
    const middle = messages.slice(3, -5);

    if (middle.length === 0) return messages;

    // Compress middle
    const middleText = middle.map(m =>
      `[${m.role}]${m.toolCalls ? ` [tools: ${m.toolCalls.map(tc => tc.name).join(", ")}]` : ""}: ${(m.content ?? "").slice(0, 500)}`,
    ).join("\n");

    const summary = await this.summarizer(
      `Summarize this conversation context in a structured way:\n\n${middleText}`,
    );

    return [
      ...head,
      { role: "system" as const, content: `[Context compressed]\n${summary}` },
      ...tail,
    ];
  }
}
