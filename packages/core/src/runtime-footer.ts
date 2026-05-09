/**
 * Runtime Footer — appends turn-level stats (token usage, tool call
 * count, duration) to each LLM message.
 */

export interface TurnStats {
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  toolNames: string[];
  durationMs: number;
}

export class RuntimeFooter {
  private startTs = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private toolCalls = 0;
  private toolNames: string[] = [];

  /** Mark the beginning of a turn */
  startTurn(): void {
    this.startTs = Date.now();
    this.inputTokens = 0;
    this.outputTokens = 0;
    this.toolCalls = 0;
    this.toolNames = [];
  }

  /** Record a tool invocation */
  recordToolCall(name: string): void {
    this.toolCalls++;
    this.toolNames.push(name);
  }

  /** Record token usage */
  recordTokens(input: number, output: number): void {
    this.inputTokens += input;
    this.outputTokens += output;
  }

  /** End the turn and return formatted footer string */
  endTurn(): string {
    const durationMs = this.startTs > 0 ? Date.now() - this.startTs : 0;
    const stats = this.getStats();

    const parts: string[] = [
      `tokens: ${stats.inputTokens}+${stats.outputTokens}`,
      `tools: ${stats.toolCalls}${stats.toolNames.length > 0 ? ` (${stats.toolNames.join(", ")})` : ""}`,
      `${(durationMs / 1000).toFixed(1)}s`,
    ];

    return `[${parts.join(" | ")}]`;
  }

  /** Get current turn stats */
  getStats(): TurnStats {
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      toolCalls: this.toolCalls,
      toolNames: [...this.toolNames],
      durationMs: this.startTs > 0 ? Date.now() - this.startTs : 0,
    };
  }
}
