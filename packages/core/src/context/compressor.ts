import type { Message } from "../types.js";

const CHAR_PER_TOKEN = 4;

export interface SummarizerFn {
  (text: string, instruction?: string): Promise<string>;
}

export interface CompressionConfig {
  enabled: boolean;
  threshold: number;        // 触发压缩的上下文使用率 (0.0-1.0)
  targetRatio: number;      // 压缩后保留的比例 (0.0-1.0)
  protectLastN: number;     // 保护最近 N 条消息不压缩
  toolOutputThreshold: number;  // 工具输出截断阈值（字符）
  toolOutputHead: number;   // 工具输出保留头部（字符）
  toolOutputTail: number;   // 工具输出保留尾部（字符）
}

const DEFAULT_COMPRESSION_CONFIG: CompressionConfig = {
  enabled: true,
  threshold: 0.50,
  targetRatio: 0.20,
  protectLastN: 20,
  toolOutputThreshold: 2000,
  toolOutputHead: 800,
  toolOutputTail: 400,
};

export class ContextCompressor {
  private config: CompressionConfig;

  constructor(config?: Partial<CompressionConfig>) {
    this.config = { ...DEFAULT_COMPRESSION_CONFIG, ...config };
  }

  shouldCompress(messages: Message[], contextWindow: number): boolean {
    if (!this.config.enabled) return false;
    const estimate = this.estimateTokens(messages);
    const usageRatio = estimate / contextWindow;
    return usageRatio > this.config.threshold;
  }

  async compress(messages: Message[], contextWindow: number, summarizer?: SummarizerFn): Promise<Message[]> {
    // 计算需要保留的消息数量
    const targetTokens = Math.floor(contextWindow * this.config.targetRatio);
    const protectCount = Math.min(this.config.protectLastN, messages.length);

    // 如果消息数少于保护数量，只做工具输出裁剪
    if (messages.length <= protectCount) {
      return this.pruneToolOutputs(messages);
    }

    // 保护最近的 N 条消息
    const tail = messages.slice(-protectCount);
    const compressible = messages.slice(0, -protectCount);

    // 如果没有可压缩的消息，只做工具输出裁剪
    if (compressible.length === 0) {
      return this.pruneToolOutputs(messages);
    }

    // 保留前几条系统消息（通常是 system prompt）
    const headCount = Math.min(3, compressible.length);
    const head = compressible.slice(0, headCount);
    const middle = compressible.slice(headCount);

    let compressedMiddle: Message;
    if (summarizer && middle.length > 0) {
      const middleText = middle
        .map(m => `[${m.role}]: ${m.content}`)
        .join("\n\n");
      try {
        const summary = await summarizer(
          middleText,
          "Summarize the conversation so far. Preserve exact values (paths, IDs, hashes, error messages) verbatim. Keep key decisions and outcomes.",
        );
        compressedMiddle = {
          role: "system",
          content: `[Conversation summary]:\n${summary}`,
        };
      } catch {
        compressedMiddle = {
          role: "system",
          content: `[Conversation summary (truncated)]:\n${this.truncateMiddle(middle)}`,
        };
      }
    } else {
      compressedMiddle = {
        role: "system",
        content: `[Conversation summary (truncated)]:\n${this.truncateMiddle(middle)}`,
      };
    }

    const result = [...head, compressedMiddle, ...tail];
    return this.pruneToolOutputs(result);
  }

  private pruneToolOutputs(messages: Message[]): Message[] {
    return messages.map(m => {
      if (m.role === "tool" && m.content.length > this.config.toolOutputThreshold) {
        const head = m.content.slice(0, this.config.toolOutputHead);
        const tailPart = m.content.slice(-this.config.toolOutputTail);
        const truncated = `${head}\n\n[... ${m.content.length - this.config.toolOutputHead - this.config.toolOutputTail} chars truncated ...]\n\n${tailPart}`;
        return { ...m, content: truncated };
      }
      return m;
    });
  }

  private truncateMiddle(middle: Message[]): string {
    const text = middle.map(m => `[${m.role}]: ${m.content}`).join("\n\n");
    const maxLen = 2000;
    if (text.length <= maxLen) return text;
    const headLen = Math.floor(maxLen * 0.6);
    const tailLen = Math.floor(maxLen * 0.4);
    return text.slice(0, headLen) + "\n[...truncated...]\n" + text.slice(-tailLen);
  }

  private estimateTokens(messages: Message[]): number {
    let total = 0;
    for (const m of messages) {
      total += Math.ceil(m.content.length / CHAR_PER_TOKEN);
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          total += Math.ceil(JSON.stringify(tc.arguments).length / CHAR_PER_TOKEN);
        }
      }
    }
    return total;
  }
}
