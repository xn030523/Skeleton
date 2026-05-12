/**
 * V4A Patch Format Parser — port of Hermes `tools/patch_parser.py`.
 *
 * V4A format (shared with codex / cline / other coding agents):
 *
 *   *** Begin Patch
 *   *** Update File: path/to/file.py
 *   @@ optional context hint @@
 *    context line (space prefix)
 *   -removed line (minus prefix)
 *   +added line (plus prefix)
 *   *** Add File: path/to/new.py
 *   +new file content
 *   +line 2
 *   *** Delete File: path/to/old.py
 *   *** Move File: old/path.py -> new/path.py
 *   *** End Patch
 *
 * Uses two-phase validate-then-apply: if any hunk fails to match during
 * validation, no filesystem changes occur. Fuzzy find/replace (9 strategies)
 * provides whitespace / unicode / escape resilience.
 */

import { fuzzyFindAndReplace } from "./fuzzy-match.js";

export enum OperationType {
  ADD = "add",
  UPDATE = "update",
  DELETE = "delete",
  MOVE = "move",
}

export interface HunkLine {
  prefix: " " | "-" | "+";
  content: string;
}

export interface Hunk {
  contextHint: string | null;
  lines: HunkLine[];
}

export interface PatchOperation {
  operation: OperationType;
  filePath: string;
  newPath?: string;        // For MOVE
  hunks: Hunk[];
  content?: string;        // For ADD (unused; we always read from hunks)
}

// ── File operations interface the apply phase needs ──────────────────

export interface RawReadResult {
  content: string;
  error: string | null;
}

export interface SimpleWriteResult {
  error: string | null;
}

export interface FileOpsForPatch {
  readFileRaw(path: string): RawReadResult;
  writeFile(path: string, content: string): SimpleWriteResult;
  deleteFile(path: string): SimpleWriteResult;
  moveFile(from: string, to: string): SimpleWriteResult;
  checkLint?(path: string): unknown;
}

export interface PatchResult {
  success: boolean;
  error?: string;
  diff?: string;
  filesModified?: string[];
  filesCreated?: string[];
  filesDeleted?: string[];
  lint?: Record<string, unknown>;
}

// ── Parser ────────────────────────────────────────────────────────────

export function parseV4APatch(patchContent: string): { operations: PatchOperation[]; error: string | null } {
  const lines = patchContent.split("\n");
  const operations: PatchOperation[] = [];

  // Find patch boundaries.
  let startIdx: number | null = null;
  let endIdx: number | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("*** Begin Patch") || line.includes("***Begin Patch")) startIdx = i;
    else if (line.includes("*** End Patch") || line.includes("***End Patch")) {
      endIdx = i;
      break;
    }
  }
  if (startIdx === null) startIdx = -1;
  if (endIdx === null) endIdx = lines.length;

  let i = startIdx + 1;
  let currentOp: PatchOperation | null = null;
  let currentHunk: Hunk | null = null;

  const flushOp = () => {
    if (currentOp) {
      if (currentHunk && currentHunk.lines.length > 0) {
        currentOp.hunks.push(currentHunk);
      }
      operations.push(currentOp);
    }
  };

  while (i < endIdx) {
    const line = lines[i];

    const updateMatch = /^\*\*\*\s*Update\s+File:\s*(.+)/.exec(line);
    const addMatch = /^\*\*\*\s*Add\s+File:\s*(.+)/.exec(line);
    const deleteMatch = /^\*\*\*\s*Delete\s+File:\s*(.+)/.exec(line);
    const moveMatch = /^\*\*\*\s*Move\s+File:\s*(.+?)\s*->\s*(.+)/.exec(line);

    if (updateMatch) {
      flushOp();
      currentOp = { operation: OperationType.UPDATE, filePath: updateMatch[1].trim(), hunks: [] };
      currentHunk = null;
    } else if (addMatch) {
      flushOp();
      currentOp = { operation: OperationType.ADD, filePath: addMatch[1].trim(), hunks: [] };
      currentHunk = { contextHint: null, lines: [] };
    } else if (deleteMatch) {
      flushOp();
      operations.push({ operation: OperationType.DELETE, filePath: deleteMatch[1].trim(), hunks: [] });
      currentOp = null;
      currentHunk = null;
    } else if (moveMatch) {
      flushOp();
      operations.push({
        operation: OperationType.MOVE,
        filePath: moveMatch[1].trim(),
        newPath: moveMatch[2].trim(),
        hunks: [],
      });
      currentOp = null;
      currentHunk = null;
    } else if (line.startsWith("@@")) {
      if (currentOp) {
        if (currentHunk && currentHunk.lines.length > 0) {
          currentOp.hunks.push(currentHunk);
        }
        const hintMatch = /@@\s*(.+?)\s*@@/.exec(line);
        currentHunk = { contextHint: hintMatch ? hintMatch[1] : null, lines: [] };
      }
    } else if (currentOp && line) {
      if (!currentHunk) currentHunk = { contextHint: null, lines: [] };
      if (line.startsWith("+")) currentHunk.lines.push({ prefix: "+", content: line.slice(1) });
      else if (line.startsWith("-")) currentHunk.lines.push({ prefix: "-", content: line.slice(1) });
      else if (line.startsWith(" ")) currentHunk.lines.push({ prefix: " ", content: line.slice(1) });
      else if (line.startsWith("\\")) {
        // "\ No newline at end of file" marker — skip
      } else {
        // Implicit space prefix
        currentHunk.lines.push({ prefix: " ", content: line });
      }
    }

    i++;
  }

  flushOp();

  if (operations.length === 0) {
    return { operations, error: null };
  }

  const errors: string[] = [];
  for (const op of operations) {
    if (!op.filePath) errors.push("Operation with empty file path");
    if (op.operation === OperationType.UPDATE && op.hunks.length === 0) {
      errors.push(`UPDATE '${op.filePath}': no hunks found`);
    }
    if (op.operation === OperationType.MOVE && !op.newPath) {
      errors.push(`MOVE '${op.filePath}': missing destination path (expected 'src -> dst')`);
    }
  }

  if (errors.length > 0) return { operations: [], error: "Parse error: " + errors.join("; ") };
  return { operations, error: null };
}

// ── Helpers ───────────────────────────────────────────────────────────

function countOccurrences(text: string, pattern: string): number {
  if (!pattern) return 0;
  let count = 0;
  let start = 0;
  while (true) {
    const pos = text.indexOf(pattern, start);
    if (pos === -1) break;
    count++;
    start = pos + 1;
  }
  return count;
}

function validateOperations(operations: PatchOperation[], fileOps: FileOpsForPatch): string[] {
  const errors: string[] = [];

  for (const op of operations) {
    if (op.operation === OperationType.UPDATE) {
      const r = fileOps.readFileRaw(op.filePath);
      if (r.error) {
        errors.push(`${op.filePath}: ${r.error}`);
        continue;
      }
      let simulated = r.content;
      for (const hunk of op.hunks) {
        const searchLines = hunk.lines.filter(l => l.prefix === " " || l.prefix === "-").map(l => l.content);
        if (searchLines.length === 0) {
          if (hunk.contextHint) {
            const occ = countOccurrences(simulated, hunk.contextHint);
            if (occ === 0) {
              errors.push(`${op.filePath}: addition-only hunk context hint '${hunk.contextHint}' not found`);
            } else if (occ > 1) {
              errors.push(`${op.filePath}: addition-only hunk context hint '${hunk.contextHint}' is ambiguous (${occ} occurrences)`);
            }
          }
          continue;
        }
        const searchPattern = searchLines.join("\n");
        const replaceLines = hunk.lines.filter(l => l.prefix === " " || l.prefix === "+").map(l => l.content);
        const replacement = replaceLines.join("\n");
        const res = fuzzyFindAndReplace(simulated, searchPattern, replacement, false);
        if (res.matchCount === 0) {
          const label = hunk.contextHint ? `'${hunk.contextHint}'` : "(no hint)";
          const detail = res.error ? ` — ${res.error}` : "";
          errors.push(`${op.filePath}: hunk ${label} not found${detail}`);
        } else {
          // Advance simulation so subsequent hunks validate correctly.
          simulated = res.newContent;
        }
      }
    } else if (op.operation === OperationType.DELETE) {
      const r = fileOps.readFileRaw(op.filePath);
      if (r.error) errors.push(`${op.filePath}: file not found for deletion`);
    } else if (op.operation === OperationType.MOVE) {
      if (!op.newPath) {
        errors.push(`${op.filePath}: MOVE operation missing destination path`);
        continue;
      }
      const src = fileOps.readFileRaw(op.filePath);
      if (src.error) errors.push(`${op.filePath}: source file not found for move`);
      const dst = fileOps.readFileRaw(op.newPath);
      if (!dst.error) errors.push(`${op.newPath}: destination already exists — move would overwrite`);
    }
    // ADD: parent directory creation handled by write_file; no pre-check.
  }
  return errors;
}

// ── Apply ─────────────────────────────────────────────────────────────

export function applyV4AOperations(
  operations: PatchOperation[],
  fileOps: FileOpsForPatch,
): PatchResult {
  // Phase 1: validate
  const vErrors = validateOperations(operations, fileOps);
  if (vErrors.length > 0) {
    return {
      success: false,
      error:
        "Patch validation failed (no files were modified):\n" +
        vErrors.map(e => `  • ${e}`).join("\n"),
    };
  }

  // Phase 2: apply
  const filesModified: string[] = [];
  const filesCreated: string[] = [];
  const filesDeleted: string[] = [];
  const allDiffs: string[] = [];
  const errors: string[] = [];

  for (const op of operations) {
    try {
      if (op.operation === OperationType.ADD) {
        const [ok, diffOrErr] = applyAdd(op, fileOps);
        if (ok) { filesCreated.push(op.filePath); allDiffs.push(diffOrErr); }
        else errors.push(`Failed to add ${op.filePath}: ${diffOrErr}`);
      } else if (op.operation === OperationType.DELETE) {
        const [ok, diffOrErr] = applyDelete(op, fileOps);
        if (ok) { filesDeleted.push(op.filePath); allDiffs.push(diffOrErr); }
        else errors.push(`Failed to delete ${op.filePath}: ${diffOrErr}`);
      } else if (op.operation === OperationType.MOVE) {
        const [ok, diffOrErr] = applyMove(op, fileOps);
        if (ok) { filesModified.push(`${op.filePath} -> ${op.newPath}`); allDiffs.push(diffOrErr); }
        else errors.push(`Failed to move ${op.filePath}: ${diffOrErr}`);
      } else if (op.operation === OperationType.UPDATE) {
        const [ok, diffOrErr] = applyUpdate(op, fileOps);
        if (ok) { filesModified.push(op.filePath); allDiffs.push(diffOrErr); }
        else errors.push(`Failed to update ${op.filePath}: ${diffOrErr}`);
      }
    } catch (e) {
      errors.push(`Error processing ${op.filePath}: ${(e as Error).message}`);
    }
  }

  const lint: Record<string, unknown> = {};
  if (fileOps.checkLint) {
    for (const f of [...filesModified, ...filesCreated]) {
      try { lint[f] = fileOps.checkLint(f); } catch { /* */ }
    }
  }

  const combinedDiff = allDiffs.join("\n");

  if (errors.length > 0) {
    return {
      success: false,
      diff: combinedDiff,
      filesModified, filesCreated, filesDeleted,
      lint: Object.keys(lint).length > 0 ? lint : undefined,
      error:
        "Apply phase failed (state may be inconsistent — run `git diff` to assess):\n" +
        errors.map(e => `  • ${e}`).join("\n"),
    };
  }

  return {
    success: true,
    diff: combinedDiff,
    filesModified, filesCreated, filesDeleted,
    lint: Object.keys(lint).length > 0 ? lint : undefined,
  };
}

function applyAdd(op: PatchOperation, fileOps: FileOpsForPatch): [boolean, string] {
  const contentLines: string[] = [];
  for (const hunk of op.hunks) {
    for (const line of hunk.lines) {
      if (line.prefix === "+") contentLines.push(line.content);
    }
  }
  const content = contentLines.join("\n");
  const r = fileOps.writeFile(op.filePath, content);
  if (r.error) return [false, r.error];

  const diff = `--- /dev/null\n+++ b/${op.filePath}\n` + contentLines.map(l => `+${l}`).join("\n");
  return [true, diff];
}

function applyDelete(op: PatchOperation, fileOps: FileOpsForPatch): [boolean, string] {
  const r = fileOps.readFileRaw(op.filePath);
  if (r.error) return [false, `Cannot delete ${op.filePath}: file not found`];
  const d = fileOps.deleteFile(op.filePath);
  if (d.error) return [false, d.error];

  const removedLines = r.content.split("\n");
  const diff =
    `--- a/${op.filePath}\n+++ /dev/null\n` +
    removedLines.map(l => `-${l}`).join("\n");
  return [true, diff || `# Deleted: ${op.filePath}`];
}

function applyMove(op: PatchOperation, fileOps: FileOpsForPatch): [boolean, string] {
  if (!op.newPath) return [false, "missing destination"];
  const r = fileOps.moveFile(op.filePath, op.newPath);
  if (r.error) return [false, r.error];
  return [true, `# Moved: ${op.filePath} -> ${op.newPath}`];
}

function applyUpdate(op: PatchOperation, fileOps: FileOpsForPatch): [boolean, string] {
  const r = fileOps.readFileRaw(op.filePath);
  if (r.error) return [false, `Cannot read file: ${r.error}`];

  const currentContent = r.content;
  let newContent = currentContent;

  for (const hunk of op.hunks) {
    const searchLines: string[] = [];
    const replaceLines: string[] = [];
    for (const line of hunk.lines) {
      if (line.prefix === " ") { searchLines.push(line.content); replaceLines.push(line.content); }
      else if (line.prefix === "-") searchLines.push(line.content);
      else if (line.prefix === "+") replaceLines.push(line.content);
    }

    if (searchLines.length > 0) {
      const searchPattern = searchLines.join("\n");
      const replacement = replaceLines.join("\n");
      let res = fuzzyFindAndReplace(newContent, searchPattern, replacement, false);

      if (res.error && res.matchCount === 0 && hunk.contextHint) {
        // Retry within a window around the context hint.
        const hintPos = newContent.indexOf(hunk.contextHint);
        if (hintPos !== -1) {
          const windowStart = Math.max(0, hintPos - 500);
          const windowEnd = Math.min(newContent.length, hintPos + 2000);
          const window = newContent.slice(windowStart, windowEnd);
          const windowRes = fuzzyFindAndReplace(window, searchPattern, replacement, false);
          if (windowRes.matchCount > 0) {
            newContent = newContent.slice(0, windowStart) + windowRes.newContent + newContent.slice(windowEnd);
            res = { ...windowRes, error: null };
          }
        }
      }

      if (res.error) return [false, `Could not apply hunk: ${res.error}`];
      if (res.matchCount === 0) return [false, "Could not apply hunk: no match"];
      newContent = res.newContent;
    } else {
      // Addition-only hunk.
      const insertText = replaceLines.join("\n");
      if (hunk.contextHint) {
        const occ = countOccurrences(newContent, hunk.contextHint);
        if (occ === 0) {
          newContent = newContent.replace(/\n+$/, "") + "\n" + insertText + "\n";
        } else if (occ > 1) {
          return [false, `Addition-only hunk: context hint '${hunk.contextHint}' is ambiguous (${occ} occurrences) — provide a more unique hint`];
        } else {
          const hintPos = newContent.indexOf(hunk.contextHint);
          const eol = newContent.indexOf("\n", hintPos);
          if (eol !== -1) {
            newContent = newContent.slice(0, eol + 1) + insertText + "\n" + newContent.slice(eol + 1);
          } else {
            newContent = newContent + "\n" + insertText;
          }
        }
      } else {
        newContent = newContent.replace(/\n+$/, "") + "\n" + insertText + "\n";
      }
    }
  }

  const write = fileOps.writeFile(op.filePath, newContent);
  if (write.error) return [false, write.error];

  // Simple unified-ish diff placeholder (full unified_diff not required for correctness).
  const diff = `--- a/${op.filePath}\n+++ b/${op.filePath}\n(edited)`;
  return [true, diff];
}
