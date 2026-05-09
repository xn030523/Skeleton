/**
 * Trajectory compressor — compresses long conversation trajectories
 * into concise training samples. Removes duplicates, truncates tool output,
 * preserves error-to-fix transitions.
 */

export interface CompressedTrajectory {
  messages: Array<{
    role: "user" | "assistant" | "tool";
    content: string;
    isKeyTurn?: boolean;
  }>;
  originalLength: number;
  compressedLength: number;
  compressionRatio: number;
}

export class TrajectoryCompressor {
  private maxToolOutputLength: number;

  constructor(config?: { maxToolOutputLength?: number }) {
    this.maxToolOutputLength = config?.maxToolOutputLength ?? 500;
  }

  /** Compress a message sequence */
  compress(messages: Array<{ role: "user" | "assistant" | "tool"; content: string }>): CompressedTrajectory {
    const originalLength = messages.reduce((sum, m) => sum + m.content.length, 0);
    let processed = this.mergeConsecutive(messages);
    processed = this.truncateToolOutput(processed);
    processed = this.preserveErrorFixTurns(processed);

    const compressedLength = processed.reduce((sum, m) => sum + m.content.length, 0);

    return {
      messages: processed,
      originalLength,
      compressedLength,
      compressionRatio: originalLength === 0 ? 1 : compressedLength / originalLength,
    };
  }

  /** Merge consecutive same-role messages */
  private mergeConsecutive(
    messages: Array<{ role: "user" | "assistant" | "tool"; content: string }>,
  ): Array<{ role: "user" | "assistant" | "tool"; content: string }> {
    const result: Array<{ role: "user" | "assistant" | "tool"; content: string }> = [];
    for (const msg of messages) {
      const last = result[result.length - 1];
      if (last && last.role === msg.role) {
        last.content += "\n" + msg.content;
      } else {
        result.push({ role: msg.role, content: msg.content });
      }
    }
    return result;
  }

  /** Truncate tool output to max length */
  private truncateToolOutput(
    messages: Array<{ role: "user" | "assistant" | "tool"; content: string; isKeyTurn?: boolean }>,
  ): Array<{ role: "user" | "assistant" | "tool"; content: string; isKeyTurn?: boolean }> {
    return messages.map(msg => {
      if (msg.role === "tool" && msg.content.length > this.maxToolOutputLength) {
        return {
          ...msg,
          content: msg.content.slice(0, this.maxToolOutputLength) + "\n...[truncated]",
        };
      }
      return msg;
    });
  }

  /** Mark and preserve error→fix transitions as key turns */
  private preserveErrorFixTurns(
    messages: Array<{ role: "user" | "assistant" | "tool"; content: string; isKeyTurn?: boolean }>,
  ): Array<{ role: "user" | "assistant" | "tool"; content: string; isKeyTurn?: boolean }> {
    const errorPattern = /(?:error|fail|exception|traceback|BUG|ERROR)/i;
    const fixPattern = /(?:fix|resolved|corrected|updated|changed|replaced)/i;

    const result = messages.map(msg => ({ ...msg, isKeyTurn: false }));
    for (let i = 0; i < result.length; i++) {
      if (result[i].role === "tool" && errorPattern.test(result[i].content)) {
        result[i].isKeyTurn = true;
        // Mark the following assistant message as key turn if it looks like a fix
        for (let j = i + 1; j < result.length && result[j].role === "assistant"; j++) {
          if (fixPattern.test(result[j].content)) {
            result[j].isKeyTurn = true;
          }
        }
      }
    }
    return result;
  }
}
