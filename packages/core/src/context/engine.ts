/**
 * Context Engine interface — pluggable context management.
 *
 * Port of Hermes `agent/context_engine.py`. Controls how conversation
 * context is managed when approaching token limits. Implementations can
 * use different strategies (summarization, sliding window, vector, etc.).
 *
 * Only one engine is active per session. Selection is config-driven.
 * Default is ContextCompressor (the built-in summarization engine).
 */

import type { Message } from "../types.js";

export interface ContextEngine {
  /** Short identifier (e.g. "compressor", "sliding_window") */
  readonly name: string;

  // ── Token state (read by agent for display/logging) ──────────────
  lastPromptTokens: number;
  lastCompletionTokens: number;
  lastTotalTokens: number;
  thresholdTokens: number;
  contextLength: number;
  compressionCount: number;

  // ── Compaction parameters ─────────────────────────────────────────
  thresholdPercent: number;
  protectFirstN: number;
  protectLastN: number;

  // ── Core interface ────────────────────────────────────────────────

  /** Update tracked token usage from an API response. */
  updateFromResponse(usage: { promptTokens: number; completionTokens: number; totalTokens: number }): void;

  /** Return true if compaction should fire this turn. */
  shouldCompress(promptTokens?: number): boolean;

  /**
   * Compact the message list and return the new message list.
   * @param messages Full message list
   * @param currentTokens Current token count (optional)
   * @param focusTopic Optional topic string from manual /compress <focus>
   */
  compress(messages: Message[], currentTokens?: number, focusTopic?: string): Promise<Message[]>;

  // ── Optional ──────────────────────────────────────────────────────

  /** Quick rough check before the API call (no real token count yet). */
  shouldCompressPreflight?(messages: Message[]): boolean;

  /** True when there is content that can be compacted. */
  hasContentToCompress?(messages: Message[]): boolean;

  /** Called when a new conversation session begins. */
  onSessionStart?(sessionId: string, opts?: Record<string, unknown>): void;

  /** Called at real session boundaries (CLI exit, /reset, gateway expiry). */
  onSessionEnd?(sessionId: string, messages: Message[]): void;

  /** Called on /new or /reset — reset per-session state. */
  onSessionReset?(): void;

  /** Return tool schemas this engine provides to the agent. */
  getToolSchemas?(): Array<Record<string, unknown>>;

  /** Handle a tool call from the agent. Must return a JSON string. */
  handleToolCall?(name: string, args: Record<string, unknown>): string;

  /** Return status dict for display/logging. */
  getStatus?(): Record<string, unknown>;

  /** Called when the user switches models or on fallback activation. */
  updateModel?(model: string, contextLength: number, opts?: Record<string, unknown>): void;
}

// ── SlidingWindowEngine ───────────────────────────────────────────────────

/** Keeps the last N messages, dropping the oldest middle messages. */
export class SlidingWindowEngine implements ContextEngine {
  readonly name = "sliding_window";

  lastPromptTokens = 0;
  lastCompletionTokens = 0;
  lastTotalTokens = 0;
  thresholdTokens = 0;
  contextLength = 0;
  compressionCount = 0;
  thresholdPercent = 0.75;
  protectFirstN = 3;
  protectLastN = 6;

  constructor(private maxMessages = 50) {}

  updateFromResponse(usage: { promptTokens: number; completionTokens: number; totalTokens: number }): void {
    this.lastPromptTokens = usage.promptTokens;
    this.lastCompletionTokens = usage.completionTokens;
    this.lastTotalTokens = usage.totalTokens;
  }

  shouldCompress(promptTokens?: number): boolean {
    const tokens = promptTokens ?? this.lastPromptTokens;
    if (this.contextLength > 0 && tokens > 0) {
      return tokens / this.contextLength > this.thresholdPercent;
    }
    return false;
  }

  async compress(messages: Message[], _currentTokens?: number, _focusTopic?: string): Promise<Message[]> {
    const keepCount = Math.min(this.maxMessages, messages.length);
    if (messages.length <= keepCount) return messages;

    const first = messages.slice(0, this.protectFirstN);
    const last = messages.slice(-this.protectLastN);
    const omitted = messages.length - first.length - last.length;
    this.compressionCount++;

    return [
      ...first,
      { role: "system" as const, content: `[Earlier context compressed: ${omitted} messages omitted]` },
      ...last,
    ];
  }

  onSessionReset(): void {
    this.lastPromptTokens = 0;
    this.lastCompletionTokens = 0;
    this.lastTotalTokens = 0;
    this.compressionCount = 0;
  }

  updateModel(_model: string, contextLength: number): void {
    this.contextLength = contextLength;
    this.thresholdTokens = Math.floor(contextLength * this.thresholdPercent);
  }

  getStatus(): Record<string, unknown> {
    return {
      lastPromptTokens: this.lastPromptTokens,
      thresholdTokens: this.thresholdTokens,
      contextLength: this.contextLength,
      usagePercent: this.contextLength > 0
        ? Math.min(100, (this.lastPromptTokens / this.contextLength) * 100)
        : 0,
      compressionCount: this.compressionCount,
    };
  }
}

// ── SummarizationEngine ───────────────────────────────────────────────────

/** Uses an auxiliary LLM to summarize the middle of the conversation. */
export class SummarizationEngine implements ContextEngine {
  readonly name = "summarization";

  lastPromptTokens = 0;
  lastCompletionTokens = 0;
  lastTotalTokens = 0;
  thresholdTokens = 0;
  contextLength = 0;
  compressionCount = 0;
  thresholdPercent = 0.75;
  protectFirstN = 3;
  protectLastN = 6;

  constructor(
    private summarizer: (text: string, instruction?: string) => Promise<string>,
    private maxMessages = 50,
  ) {}

  updateFromResponse(usage: { promptTokens: number; completionTokens: number; totalTokens: number }): void {
    this.lastPromptTokens = usage.promptTokens;
    this.lastCompletionTokens = usage.completionTokens;
    this.lastTotalTokens = usage.totalTokens;
  }

  shouldCompress(promptTokens?: number): boolean {
    const tokens = promptTokens ?? this.lastPromptTokens;
    if (this.contextLength > 0 && tokens > 0) {
      return tokens / this.contextLength > this.thresholdPercent;
    }
    return false;
  }

  hasContentToCompress(messages: Message[]): boolean {
    const compressible = messages.length - this.protectFirstN - this.protectLastN;
    return compressible > 0;
  }

  async compress(messages: Message[], _currentTokens?: number, focusTopic?: string): Promise<Message[]> {
    if (messages.length <= this.protectFirstN + this.protectLastN) return messages;

    const head = messages.slice(0, this.protectFirstN);
    const tail = messages.slice(-this.protectLastN);
    const middle = messages.slice(this.protectFirstN, -this.protectLastN);

    if (middle.length === 0) return messages;

    const middleText = middle.map(m =>
      `[${m.role}]${m.toolCalls ? ` [tools: ${m.toolCalls.map(tc => tc.name).join(", ")}]` : ""}: ${(m.content ?? "").slice(0, 500)}`,
    ).join("\n");

    const instruction = focusTopic
      ? `Summarize this conversation. Focus especially on: ${focusTopic}. Preserve all details related to this topic verbatim.`
      : "Summarize this conversation context. Preserve exact values (paths, IDs, hashes, error messages) verbatim.";

    const summary = await this.summarizer(middleText, instruction);
    this.compressionCount++;

    return [
      ...head,
      { role: "system" as const, content: `[Context compressed]\n${summary}` },
      ...tail,
    ];
  }

  onSessionReset(): void {
    this.lastPromptTokens = 0;
    this.lastCompletionTokens = 0;
    this.lastTotalTokens = 0;
    this.compressionCount = 0;
  }

  updateModel(_model: string, contextLength: number): void {
    this.contextLength = contextLength;
    this.thresholdTokens = Math.floor(contextLength * this.thresholdPercent);
  }

  getStatus(): Record<string, unknown> {
    return {
      lastPromptTokens: this.lastPromptTokens,
      thresholdTokens: this.thresholdTokens,
      contextLength: this.contextLength,
      usagePercent: this.contextLength > 0
        ? Math.min(100, (this.lastPromptTokens / this.contextLength) * 100)
        : 0,
      compressionCount: this.compressionCount,
    };
  }
}
