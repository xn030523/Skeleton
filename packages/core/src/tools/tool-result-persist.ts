/**
 * Tool Result Persistence — layer between agent and context window.
 *
 * After tool execution, if the result exceeds a threshold, write it to a temp
 * file and replace the in-context content with a truncated preview plus a
 * pointer to the persisted file. Supports reading persisted results back.
 *
 * Complements output-limits.ts (Layer 1 truncation / Layer 3 turn budget)
 * by handling the Layer 2 persist-and-preview step as a standalone API.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULT_THRESHOLD = 50_000;
const PREVIEW_HEAD = 2000;
const PREVIEW_TAIL = 1000;

const TMP_DIR = path.join(os.tmpdir(), "skeleton-persisted-results");

export interface PersistResult {
  preview: string;
  persistedPath: string;
}

/** Persist a large tool result to disk, return preview for context injection */
export function persistToolResult(
  toolName: string,
  resultId: string,
  content: string,
  threshold: number = DEFAULT_THRESHOLD,
): PersistResult {
  fs.mkdirSync(TMP_DIR, { recursive: true });

  const safeName = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeId = resultId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const persistedPath = path.join(TMP_DIR, `${safeName}_${safeId}.txt`);

  fs.writeFileSync(persistedPath, content, "utf-8");

  const preview = buildPreview(content);
  const sizeKB = (content.length / 1024).toFixed(1);
  const full = `${preview}\n\n[Full result (${sizeKB}KB) at: ${persistedPath}]`;

  return { preview: full, persistedPath };
}

/** Read a previously persisted result from disk */
export function readPersistedResult(persistedPath: string): string {
  const resolved = path.resolve(persistedPath);

  if (!resolved.startsWith(path.resolve(TMP_DIR))) {
    throw new Error(`Persisted result path outside allowed directory: ${persistedPath}`);
  }

  if (!fs.existsSync(resolved)) {
    throw new Error(`Persisted result not found: ${persistedPath}`);
  }

  return fs.readFileSync(resolved, "utf-8");
}

function buildPreview(content: string): string {
  if (content.length <= PREVIEW_HEAD + PREVIEW_TAIL) return content;
  const head = content.slice(0, PREVIEW_HEAD);
  const tail = content.slice(-PREVIEW_TAIL);
  const omitted = content.length - PREVIEW_HEAD - PREVIEW_TAIL;
  return `${head}\n\n[... ${omitted} chars omitted, see persisted file ...]\n\n${tail}`;
}
