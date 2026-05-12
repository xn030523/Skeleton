import crypto from "node:crypto";
import type { Message } from "../types.js";

const CHAR_PER_TOKEN = 4;
const PRUNED_TOOL_PLACEHOLDER = "[Old tool output cleared to save context space]";
const SUMMARY_FAILURE_COOLDOWN_MS = 600_000; // 600s — matches Hermes

export interface SummarizerFn {
  (text: string, instruction?: string): Promise<string>;
}

export interface CompressionConfig {
  enabled: boolean;
  threshold: number;
  targetRatio: number;
  protectLastN: number;
  toolOutputThreshold: number;
  toolOutputHead: number;
  toolOutputTail: number;
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

// ── Tool result summarizer (Hermes _summarize_tool_result) ────────────────

function summarizeToolResult(toolName: string, toolArgs: string, content: string): string {
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(toolArgs || "{}"); } catch { /* */ }

  const contentLen = content.length;
  const lineCount = content.trim() ? content.split("\n").length : 0;

  switch (toolName) {
    case "terminal": {
      let cmd = String(args.command ?? "");
      if (cmd.length > 80) cmd = cmd.slice(0, 77) + "...";
      const exitMatch = /"exit_code"\s*:\s*(-?\d+)/.exec(content);
      const exitCode = exitMatch ? exitMatch[1] : "?";
      return `[terminal] ran \`${cmd}\` -> exit ${exitCode}, ${lineCount} lines output`;
    }
    case "read_file":
      return `[read_file] read ${args.path ?? "?"} from line ${args.offset ?? 1} (${contentLen.toLocaleString()} chars)`;
    case "write_file": {
      const writtenLines = typeof args.content === "string" ? args.content.split("\n").length : "?";
      return `[write_file] wrote to ${args.path ?? "?"} (${writtenLines} lines)`;
    }
    case "search_files": {
      const countMatch = /"total_count"\s*:\s*(\d+)/.exec(content);
      const count = countMatch ? countMatch[1] : "?";
      return `[search_files] search for '${args.pattern ?? "?"}' in ${args.path ?? "."} -> ${count} matches`;
    }
    case "edit_file":
    case "patch_file":
      return `[${toolName}] in ${args.path ?? "?"} (${contentLen.toLocaleString()} chars result)`;
    case "web_search":
      return `[web_search] query='${args.query ?? "?"}' (${contentLen.toLocaleString()} chars result)`;
    case "web_fetch":
      return `[web_fetch] ${args.url ?? "?"} (${contentLen.toLocaleString()} chars)`;
    case "vision_analyze":
      return `[vision_analyze] '${String(args.question ?? "").slice(0, 50)}' (${contentLen.toLocaleString()} chars)`;
    case "skill_view":
    case "skill_manage":
      return `[${toolName}] name=${args.name ?? "?"} (${contentLen.toLocaleString()} chars)`;
    case "memory":
      return `[memory] ${args.action ?? "?"} on ${args.target ?? "?"}`;
    case "execute_code": {
      const codePreview = String(args.script ?? args.code ?? "").slice(0, 60).replace(/\n/g, " ");
      return `[execute_code] \`${codePreview}\` (${lineCount} lines output)`;
    }
    default:
      return `[${toolName}] (${contentLen.toLocaleString()} chars)`;
  }
}

export class ContextCompressor {
  private config: CompressionConfig;

  // Anti-thrashing state (Hermes _ineffective_compression_count)
  private ineffectiveCompressionCount = 0;
  private summaryFailureCooldownUntil = 0;  // Date.now() ms
  private lastCompressionSavingsPct = 100;

  constructor(config?: Partial<CompressionConfig>) {
    this.config = { ...DEFAULT_COMPRESSION_CONFIG, ...config };
  }

  shouldCompress(messages: Message[], contextWindow: number): boolean {
    if (!this.config.enabled) return false;
    const estimate = this.estimateTokens(messages);
    const usageRatio = estimate / contextWindow;
    if (usageRatio <= this.config.threshold) return false;

    // Anti-thrashing: back off if recent compressions were ineffective
    if (this.ineffectiveCompressionCount >= 2) {
      return false;
    }

    return true;
  }

  async compress(messages: Message[], contextWindow: number, summarizer?: SummarizerFn): Promise<Message[]> {
    const protectCount = Math.min(this.config.protectLastN, messages.length);
    const tokensBefore = this.estimateTokens(messages);

    // Phase 1: Prune old tool results (cheap, no LLM call) — Hermes 3-pass
    const { pruned: prunedMessages } = this.pruneOldToolResults(messages, protectCount);

    if (prunedMessages.length <= protectCount) {
      return this.pruneToolOutputs(prunedMessages);
    }

    const tail = prunedMessages.slice(-protectCount);
    const compressible = prunedMessages.slice(0, -protectCount);

    if (compressible.length === 0) {
      return this.pruneToolOutputs(prunedMessages);
    }

    const headCount = Math.min(3, compressible.length);
    const head = compressible.slice(0, headCount);
    const middle = compressible.slice(headCount);

    let compressedMiddle: Message;

    // Check summary failure cooldown before attempting LLM summarization
    const now = Date.now();
    const inCooldown = now < this.summaryFailureCooldownUntil;

    if (summarizer && middle.length > 0 && !inCooldown) {
      const middleText = middle.map(m => `[${m.role}]: ${m.content}`).join("\n\n");
      try {
        const summary = await summarizer(
          middleText,
          "Summarize the conversation so far. Preserve exact values (paths, IDs, hashes, error messages) verbatim. Keep key decisions and outcomes.",
        );
        // Clear cooldown on success
        this.summaryFailureCooldownUntil = 0;
        compressedMiddle = { role: "system", content: `[Conversation summary]:\n${summary}` };
      } catch {
        // Set cooldown on failure (60s transient, 600s permanent)
        this.summaryFailureCooldownUntil = Date.now() + 60_000;
        compressedMiddle = { role: "system", content: `[Conversation summary (truncated)]:\n${this.truncateMiddle(middle)}` };
      }
    } else {
      compressedMiddle = { role: "system", content: `[Conversation summary (truncated)]:\n${this.truncateMiddle(middle)}` };
    }

    const result = [...head, compressedMiddle, ...tail];
    const finalResult = this.pruneToolOutputs(result);

    // Track compression effectiveness for anti-thrashing
    const tokensAfter = this.estimateTokens(finalResult);
    const savingsPct = tokensBefore > 0 ? ((tokensBefore - tokensAfter) / tokensBefore) * 100 : 100;
    this.lastCompressionSavingsPct = savingsPct;
    if (savingsPct < 10) {
      this.ineffectiveCompressionCount++;
    } else {
      this.ineffectiveCompressionCount = 0;
    }

    return finalResult;
  }

  /**
   * 3-Pass tool result pruning (Hermes _prune_old_tool_results):
   *   Pass 1: MD5 dedup — identical results replaced with back-reference
   *   Pass 2: Informative 1-line summary for old large tool results
   *   Pass 3: Truncate large tool_call arguments in assistant messages
   */
  pruneOldToolResults(messages: Message[], protectTailCount: number): { pruned: Message[]; count: number } {
    const result = messages.map(m => ({ ...m }));
    let prunedCount = 0;
    const pruneBoundary = Math.max(0, result.length - protectTailCount);

    // Build call_id → (toolName, argsJson) map from assistant messages
    const callIdToTool = new Map<string, [string, string]>();
    for (const msg of result) {
      if (msg.role === "assistant" && msg.toolCalls) {
        for (const tc of msg.toolCalls) {
          if (tc.id) {
            callIdToTool.set(tc.id, [tc.name, JSON.stringify(tc.arguments ?? {})]);
          }
        }
      }
    }

    // Pass 1: MD5 dedup
    const contentHashes = new Map<string, number>();
    for (let i = 0; i < pruneBoundary; i++) {
      const msg = result[i];
      if (msg.role !== "tool") continue;
      const content = msg.content ?? "";
      if (content.length < 200) continue;
      const h = crypto.createHash("md5").update(content, "utf-8").digest("hex").slice(0, 12);
      if (contentHashes.has(h)) {
        result[i] = { ...msg, content: "[Duplicate tool output — same content as a more recent call]" };
        prunedCount++;
      } else {
        contentHashes.set(h, i);
      }
    }

    // Pass 2: Replace old tool results with informative summaries
    for (let i = 0; i < pruneBoundary; i++) {
      const msg = result[i];
      if (msg.role !== "tool") continue;
      const content = msg.content ?? "";
      if (!content || content === PRUNED_TOOL_PLACEHOLDER) continue;
      if (content.startsWith("[Duplicate tool output")) continue;
      if (content.length <= 200) continue;

      const callId = msg.toolCallId ?? "";
      const [toolName, toolArgs] = callIdToTool.get(callId) ?? ["unknown", "{}"];
      const summary = summarizeToolResult(toolName, toolArgs, content);
      result[i] = { ...msg, content: summary };
      prunedCount++;
    }

    // Pass 3: Truncate large tool_call arguments in assistant messages
    const MAX_ARGS_CHARS = 2000;
    for (let i = 0; i < pruneBoundary; i++) {
      const msg = result[i];
      if (msg.role !== "assistant" || !msg.toolCalls) continue;
      let changed = false;
      const newTcs = msg.toolCalls.map(tc => {
        const argsStr = JSON.stringify(tc.arguments ?? {});
        if (argsStr.length <= MAX_ARGS_CHARS) return tc;
        changed = true;
        return { ...tc, arguments: { _truncated: `[args truncated: ${argsStr.length} chars]` } };
      });
      if (changed) result[i] = { ...msg, toolCalls: newTcs };
    }

    return { pruned: result, count: prunedCount };
  }

  private pruneToolOutputs(messages: Message[]): Message[] {
    return messages.map(m => {
      if (m.role === "tool" && (m.content?.length ?? 0) > this.config.toolOutputThreshold) {
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

  estimateTokens(messages: Message[]): number {
    let total = 0;
    for (const m of messages) {
      total += Math.ceil((m.content?.length ?? 0) / CHAR_PER_TOKEN);
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          total += Math.ceil(JSON.stringify(tc.arguments).length / CHAR_PER_TOKEN);
        }
      }
    }
    return total;
  }
}
