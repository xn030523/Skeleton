/**
 * Tool Output Limits — 3-layer defense against context-window overflow.
 *
 * Ports Hermes `tools/tool_result_storage.py` + `tools/budget_config.py`.
 *
 *   Layer 1 (per-tool cap)    — truncateOutput() called by the tool itself
 *   Layer 2 (per-result)      — maybePersistResult(): single result > threshold
 *                               → full content saved to disk, preview + ref
 *                               returned; wrapped in <persisted-output> tag
 *                               so subsequent layers and reviewers recognize it
 *   Layer 3 (per-turn budget) — enforceTurnBudget(): aggregate across all tool
 *                               results in one assistant turn; if over budget,
 *                               spill the largest non-persisted results
 *
 * `read_file` has its threshold pinned to `Infinity` to prevent
 * persist → read → persist loops (the read_file tool is the primary way to
 * retrieve persisted content).
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ── Public constants (match Hermes exactly) ──────────────────────────

export const DEFAULT_RESULT_SIZE_CHARS = 100_000;
export const DEFAULT_TURN_BUDGET_CHARS = 200_000;
export const DEFAULT_PREVIEW_SIZE_CHARS = 1_500;

export const PERSISTED_OUTPUT_TAG = "<persisted-output>";
export const PERSISTED_OUTPUT_CLOSING_TAG = "</persisted-output>";

/** Tools whose thresholds must never be overridden (prevents loops). */
const PINNED_THRESHOLDS: Record<string, number> = {
  read_file: Number.POSITIVE_INFINITY,
};

/** Storage dir for persisted tool results. */
const STORAGE_DIR = path.join(os.tmpdir(), "skeleton-results");

// ── BudgetConfig ─────────────────────────────────────────────────────

export interface BudgetConfig {
  /** Default per-result threshold when no pinned / override applies. */
  defaultResultSize: number;
  /** Aggregate budget across all tool results in one turn. */
  turnBudget: number;
  /** Preview size shown inline after persistence. */
  previewSize: number;
  /** Per-tool threshold overrides. */
  toolOverrides: Record<string, number>;
  /**
   * Legacy line-count cap (not in Hermes). Kept for backward compat with
   * the terminal/search tools that rely on it for UX. Set to 0 to disable.
   */
  maxLines?: number;
  /** Legacy per-line length cap. */
  maxLineLength?: number;
}

export const DEFAULT_BUDGET: BudgetConfig = {
  defaultResultSize: DEFAULT_RESULT_SIZE_CHARS,
  turnBudget: DEFAULT_TURN_BUDGET_CHARS,
  previewSize: DEFAULT_PREVIEW_SIZE_CHARS,
  toolOverrides: {},
  maxLines: 2000,
  maxLineLength: 10_000,
};

/** Resolve the persistence threshold for a tool.
 *  Priority: pinned (infinite) > toolOverrides > default. */
export function resolveThreshold(toolName: string, config: BudgetConfig = DEFAULT_BUDGET): number {
  if (toolName in PINNED_THRESHOLDS) return PINNED_THRESHOLDS[toolName];
  if (toolName in config.toolOverrides) return config.toolOverrides[toolName];
  return config.defaultResultSize;
}

/** Legacy wrapper — older code asked for full BudgetConfig per tool. */
export function resolveBudget(toolName?: string, overrides?: Partial<BudgetConfig>): BudgetConfig {
  return {
    ...DEFAULT_BUDGET,
    ...overrides,
    toolOverrides: {
      ...DEFAULT_BUDGET.toolOverrides,
      ...(overrides?.toolOverrides ?? {}),
    },
  };
}

// ── Preview generation ───────────────────────────────────────────────

/** Truncate at last newline within maxChars. Returns [preview, hasMore]. */
export function generatePreview(
  content: string,
  maxChars = DEFAULT_PREVIEW_SIZE_CHARS,
): [string, boolean] {
  if (content.length <= maxChars) return [content, false];
  let truncated = content.slice(0, maxChars);
  const lastNl = truncated.lastIndexOf("\n");
  if (lastNl > maxChars / 2) truncated = truncated.slice(0, lastNl + 1);
  return [truncated, true];
}

// ── Layer 1: Per-tool truncation ─────────────────────────────────────

/** Truncate oversized tool output by char/line count with head+tail preview. */
export function truncateOutput(output: string, config: BudgetConfig = DEFAULT_BUDGET): string {
  const maxChars = config.defaultResultSize;
  if (output.length > maxChars) {
    const head = output.slice(0, Math.floor(maxChars * 0.7));
    const tail = output.slice(-Math.floor(maxChars * 0.3));
    const omitted = output.length - head.length - tail.length;
    return `${head}\n\n[... ${omitted} chars omitted (max ${maxChars}) ...]\n\n${tail}`;
  }
  const maxLines = config.maxLines ?? 0;
  if (maxLines > 0) {
    const lines = output.split("\n");
    if (lines.length > maxLines) {
      const headLines = lines.slice(0, Math.floor(maxLines * 0.7));
      const tailLines = lines.slice(-Math.floor(maxLines * 0.3));
      const omittedLines = lines.length - headLines.length - tailLines.length;
      return `${headLines.join("\n")}\n\n[... ${omittedLines} lines omitted (max ${maxLines}) ...]\n\n${tailLines.join("\n")}`;
    }
  }
  const maxLineLen = config.maxLineLength ?? 0;
  if (maxLineLen > 0) {
    return output.split("\n").map(line =>
      line.length > maxLineLen
        ? line.slice(0, maxLineLen) + ` [... ${line.length - maxLineLen} more chars]`
        : line,
    ).join("\n");
  }
  return output;
}

// ── Layer 2: Per-result persistence ──────────────────────────────────

function buildPersistedMessage(
  preview: string,
  hasMore: boolean,
  originalSize: number,
  filePath: string,
): string {
  const sizeKb = originalSize / 1024;
  const sizeStr = sizeKb >= 1024 ? `${(sizeKb / 1024).toFixed(1)} MB` : `${sizeKb.toFixed(1)} KB`;
  return (
    `${PERSISTED_OUTPUT_TAG}\n` +
    `This tool result was too large (${originalSize.toLocaleString()} characters, ${sizeStr}).\n` +
    `Full output saved to: ${filePath}\n` +
    `Use the read_file tool with offset and limit to access specific sections of this output.\n\n` +
    `Preview (first ${preview.length} chars):\n` +
    `${preview}${hasMore ? "\n..." : ""}\n` +
    `${PERSISTED_OUTPUT_CLOSING_TAG}`
  );
}

/**
 * Persist oversized tool result to disk, return preview + path reference.
 * No-op if content is within threshold or threshold is Infinity.
 */
export function maybePersistResult(
  toolName: string,
  toolUseId: string,
  content: string,
  config: BudgetConfig = DEFAULT_BUDGET,
  thresholdOverride?: number,
): { context: string; persistedPath?: string } {
  const threshold = thresholdOverride !== undefined
    ? thresholdOverride
    : resolveThreshold(toolName, config);

  if (!isFinite(threshold)) return { context: content };
  if (content.length <= threshold) return { context: content };

  const [preview, hasMore] = generatePreview(content, config.previewSize);

  try {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
    const filePath = path.join(STORAGE_DIR, `${toolUseId}.txt`);
    fs.writeFileSync(filePath, content, "utf-8");
    return {
      context: buildPersistedMessage(preview, hasMore, content.length, filePath),
      persistedPath: filePath,
    };
  } catch {
    // Fallback: inline-truncated preview only
    return {
      context:
        `${preview}\n\n` +
        `[Truncated: tool response was ${content.length.toLocaleString()} chars. ` +
        `Full output could not be saved to disk.]`,
    };
  }
}

// ── Layer 3: Per-turn aggregate budget ───────────────────────────────

export interface TurnBudgetMessage {
  toolName: string;
  toolUseId: string;
  content: string;
}

/**
 * If aggregate size across all tool results in a turn exceeds budget, persist
 * the largest non-persisted results until under budget. Messages already
 * wrapped in <persisted-output> are skipped.
 *
 * Mutates the list (updates .content) and returns it.
 */
export function enforceTurnBudget(
  messages: TurnBudgetMessage[],
  config: BudgetConfig = DEFAULT_BUDGET,
): TurnBudgetMessage[] {
  let totalSize = 0;
  const candidates: Array<{ idx: number; size: number }> = [];
  for (let i = 0; i < messages.length; i++) {
    const size = messages[i].content.length;
    totalSize += size;
    if (!messages[i].content.includes(PERSISTED_OUTPUT_TAG)) {
      candidates.push({ idx: i, size });
    }
  }

  if (totalSize <= config.turnBudget) return messages;

  // Spill largest first.
  candidates.sort((a, b) => b.size - a.size);

  for (const { idx, size } of candidates) {
    if (totalSize <= config.turnBudget) break;
    const msg = messages[idx];
    const { context } = maybePersistResult(
      msg.toolName,
      msg.toolUseId,
      msg.content,
      config,
      0, // force persistence regardless of per-tool threshold
    );
    if (context !== msg.content) {
      totalSize -= size;
      totalSize += context.length;
      messages[idx].content = context;
    }
  }
  return messages;
}

// ── Cleanup ──────────────────────────────────────────────────────────

/** Remove persisted result files older than maxAgeMs (default 1h). */
export function cleanupPersistedResults(maxAgeMs = 3600_000): void {
  if (!fs.existsSync(STORAGE_DIR)) return;
  const now = Date.now();
  try {
    for (const file of fs.readdirSync(STORAGE_DIR)) {
      const fp = path.join(STORAGE_DIR, file);
      try {
        const stat = fs.statSync(fp);
        if (now - stat.mtimeMs > maxAgeMs) fs.unlinkSync(fp);
      } catch { /* skip */ }
    }
  } catch { /* skip */ }
}

export function getStorageDir(): string {
  return STORAGE_DIR;
}
