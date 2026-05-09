/**
 * Tool Output Limits — 3-layer defense against context-window overflow.
 *
 * Layer 1: Per-tool output cap (truncate oversized results)
 * Layer 2: Per-result persistence to disk when output exceeds threshold
 * Layer 3: Per-turn aggregate budget spilling largest results to disk
 *
 * Inspired by Hermes tool_result_storage.py + budget_config.py.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULT_MAX_BYTES = 100_000;     // 100KB per tool result
const DEFAULT_MAX_LINES = 2000;
const DEFAULT_TURN_BUDGET = 500_000;   // 500KB per turn aggregate
const PERSIST_THRESHOLD = 50_000;      // 50KB → persist to disk
const PREVIEW_HEAD = 2000;
const PREVIEW_TAIL = 1000;

const TMP_DIR = path.join(os.tmpdir(), "skeleton-tool-results");

export interface BudgetConfig {
  maxBytes: number;
  maxLines: number;
  maxLineLength: number;
  turnBudgetBytes: number;
  persistThreshold: number;
}

const DEFAULT_BUDGET: BudgetConfig = {
  maxBytes: DEFAULT_MAX_BYTES,
  maxLines: DEFAULT_MAX_LINES,
  maxLineLength: 10_000,
  turnBudgetBytes: DEFAULT_TURN_BUDGET,
  persistThreshold: PERSIST_THRESHOLD,
};

// Per-tool overrides for known high-output tools
const PINNED_THRESHOLDS: Record<string, Partial<BudgetConfig>> = {
  terminal: { maxBytes: 200_000, maxLines: 5000 },
  read_file: { maxBytes: 200_000 },
  search_files: { maxBytes: 50_000 },
  web_search: { maxBytes: 30_000 },
  web_fetch: { maxBytes: 50_000 },
  hexdump: { maxBytes: 50_000 },
  strings: { maxBytes: 30_000 },
};

/** Resolve budget config for a specific tool */
export function resolveBudget(toolName?: string, overrides?: Partial<BudgetConfig>): BudgetConfig {
  const pinned = toolName ? PINNED_THRESHOLDS[toolName] : undefined;
  return {
    ...DEFAULT_BUDGET,
    ...pinned,
    ...overrides,
  };
}

/** Layer 1: Truncate oversized tool output */
export function truncateOutput(output: string, config: BudgetConfig): string {
  // Truncate by byte count
  if (output.length > config.maxBytes) {
    const head = output.slice(0, Math.floor(config.maxBytes * 0.7));
    const tail = output.slice(-Math.floor(config.maxBytes * 0.3));
    const omitted = output.length - head.length - tail.length;
    return `${head}\n\n[... ${omitted} chars omitted (max ${config.maxBytes}) ...]\n\n${tail}`;
  }

  // Truncate by line count
  const lines = output.split("\n");
  if (lines.length > config.maxLines) {
    const headLines = lines.slice(0, Math.floor(config.maxLines * 0.7));
    const tailLines = lines.slice(-Math.floor(config.maxLines * 0.3));
    const omittedLines = lines.length - headLines.length - tailLines.length;
    return `${headLines.join("\n")}\n\n[... ${omittedLines} lines omitted (max ${config.maxLines}) ...]\n\n${tailLines.join("\n")}`;
  }

  // Truncate long lines
  return lines.map(line =>
    line.length > config.maxLineLength
      ? line.slice(0, config.maxLineLength) + ` [... ${line.length - config.maxLineLength} more chars]`
      : line,
  ).join("\n");
}

/** Layer 2: Persist large tool result to disk, return preview for context */
export function maybePersistResult(
  toolName: string,
  resultId: string,
  output: string,
  config: BudgetConfig,
): { context: string; persistedPath?: string } {
  if (output.length < config.persistThreshold) {
    return { context: output };
  }

  // Persist to disk
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const filePath = path.join(TMP_DIR, `${toolName}_${resultId}.txt`);
  fs.writeFileSync(filePath, output, "utf-8");

  // Generate preview
  const preview = generatePreview(output);
  const context = `${preview}\n\n[Full result (${(output.length / 1024).toFixed(1)}KB) persisted to: ${filePath}]`;

  return { context, persistedPath: filePath };
}

/** Layer 3: Enforce per-turn aggregate budget */
export function enforceTurnBudget(
  results: Array<{ toolName: string; output: string; resultId: string }>,
  config: BudgetConfig,
): Array<{ toolName: string; output: string }> {
  const totalBytes = results.reduce((sum, r) => sum + r.output.length, 0);

  if (totalBytes <= config.turnBudgetBytes) {
    return results.map(r => ({ toolName: r.toolName, output: truncateOutput(r.output, resolveBudget(r.toolName)) }));
  }

  // Sort by size descending — spill largest to disk first
  const sorted = [...results].sort((a, b) => b.output.length - a.output.length);
  let budgetUsed = 0;
  const finalResults: Array<{ toolName: string; output: string }> = [];

  for (const result of sorted) {
    const remaining = config.turnBudgetBytes - budgetUsed;

    if (result.output.length <= remaining) {
      // Fits in budget
      const processed = truncateOutput(result.output, resolveBudget(result.toolName));
      finalResults.push({ toolName: result.toolName, output: processed });
      budgetUsed += processed.length;
    } else {
      // Spill to disk
      const { context } = maybePersistResult(result.toolName, result.resultId, result.output, resolveBudget(result.toolName));
      finalResults.push({ toolName: result.toolName, output: context });
      budgetUsed += context.length;
    }
  }

  return finalResults;
}

function generatePreview(output: string): string {
  if (output.length <= PREVIEW_HEAD + PREVIEW_TAIL) return output;
  const head = output.slice(0, PREVIEW_HEAD);
  const tail = output.slice(-PREVIEW_TAIL);
  const omitted = output.length - PREVIEW_HEAD - PREVIEW_TAIL;
  return `${head}\n\n[... ${omitted} chars omitted, see persisted file ...]\n\n${tail}`;
}

/** Clean up persisted results older than maxAgeMs */
export function cleanupPersistedResults(maxAgeMs: number = 3600_000): void {
  if (!fs.existsSync(TMP_DIR)) return;
  const now = Date.now();
  for (const file of fs.readdirSync(TMP_DIR)) {
    const filePath = path.join(TMP_DIR, file);
    try {
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
      }
    } catch { /* skip */ }
  }
}
