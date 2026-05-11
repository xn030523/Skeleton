/**
 * Inline Diff Previews — render file changes visually after write_file/patch/edit.
 *
 * Shows unified diff in tool output so user sees what changed before agent proceeds.
 * Registers as a post_tool_call hook.
 */

import fs from "node:fs";
import path from "node:path";
import type { HookContext, HookResult } from "../hooks.js";

const WRITE_TOOLS = new Set(["write_file", "patch", "edit", "fuzzy_edit"]);
const MAX_DIFF_LINES = 40;
const MAX_LINE_LEN = 200;

/** Snapshot cache for before-content (captured in pre_tool_call) */
const beforeSnapshots = new Map<string, string>();

/** Pre-tool-call hook: snapshot file content before write */
export function inlineDiffPreHook(ctx: HookContext): HookResult {
  const toolName = ctx.toolName ?? "";
  if (!WRITE_TOOLS.has(toolName)) return {};

  const filePath = String(
    (ctx.args as Record<string, unknown>)?.path ??
    (ctx.args as Record<string, unknown>)?.file_path ??
    "",
  );
  if (!filePath) return {};

  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      beforeSnapshots.set(filePath, content);
    } else {
      beforeSnapshots.set(filePath, "");
    }
  } catch { /* ignore */ }

  return {};
}

/** Post-tool-call hook: render unified diff into context injection */
export function inlineDiffPostHook(ctx: HookContext): HookResult {
  const toolName = ctx.toolName ?? "";
  if (!WRITE_TOOLS.has(toolName)) return {};

  const filePath = String(
    (ctx.args as Record<string, unknown>)?.path ??
    (ctx.args as Record<string, unknown>)?.file_path ??
    "",
  );
  if (!filePath) return {};

  const before = beforeSnapshots.get(filePath) ?? "";
  beforeSnapshots.delete(filePath);

  let after = "";
  try {
    if (fs.existsSync(filePath)) after = fs.readFileSync(filePath, "utf-8");
  } catch { return {}; }

  if (before === after) return {};

  const diff = unifiedDiff(before, after, filePath);
  if (!diff) return {};

  return {
    contextInjection: `\n[INLINE DIFF — ${path.basename(filePath)}]\n${diff}\n`,
  };
}

/** Minimal unified-diff renderer (no external dependencies) */
function unifiedDiff(before: string, after: string, filePath: string): string {
  const beforeLines = before ? before.split("\n") : [];
  const afterLines = after.split("\n");

  const ops = computeDiff(beforeLines, afterLines);
  if (ops.length === 0) return "";

  const lines: string[] = [];
  lines.push(`--- a/${filePath}`);
  lines.push(`+++ b/${filePath}`);

  let rendered = 0;
  for (const op of ops) {
    if (rendered >= MAX_DIFF_LINES) {
      lines.push(`... (${ops.length - rendered} more changes truncated)`);
      break;
    }
    const line = op.text.length > MAX_LINE_LEN
      ? op.text.slice(0, MAX_LINE_LEN) + "..."
      : op.text;
    if (op.type === "add") lines.push(`+${line}`);
    else if (op.type === "del") lines.push(`-${line}`);
    else lines.push(` ${line}`);
    rendered++;
  }

  return lines.join("\n");
}

interface DiffOp { type: "add" | "del" | "ctx"; text: string }

/** Simple line-level diff using LCS-ish scan (good enough for preview) */
function computeDiff(a: string[], b: string[]): DiffOp[] {
  const ops: DiffOp[] = [];
  let i = 0, j = 0;

  while (i < a.length || j < b.length) {
    if (i >= a.length) {
      ops.push({ type: "add", text: b[j++] });
    } else if (j >= b.length) {
      ops.push({ type: "del", text: a[i++] });
    } else if (a[i] === b[j]) {
      // skip unchanged (only include a couple context lines around changes)
      i++; j++;
    } else {
      // Lookahead: does a[i] appear soon in b?
      const aInB = b.indexOf(a[i], j);
      const bInA = a.indexOf(b[j], i);

      if (aInB !== -1 && (bInA === -1 || aInB - j <= bInA - i)) {
        // b has extra lines before a[i]
        while (j < aInB) ops.push({ type: "add", text: b[j++] });
      } else if (bInA !== -1) {
        // a has extra lines before b[j]
        while (i < bInA) ops.push({ type: "del", text: a[i++] });
      } else {
        // replacement
        ops.push({ type: "del", text: a[i++] });
        ops.push({ type: "add", text: b[j++] });
      }
    }
  }

  return ops;
}
