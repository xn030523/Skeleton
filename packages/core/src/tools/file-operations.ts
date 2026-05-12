/**
 * File Operations — local-fs implementation with a backend-swappable interface.
 *
 * Port of Hermes `tools/file_operations.py` (simplified for Skeleton's needs).
 * The Hermes version has a full abstract interface so the same code runs on
 * local / docker / ssh / modal / daytona / vercel sandbox. This first cut
 * implements LocalFileOperations directly via Node's fs; remote backend
 * wrapping is left as a follow-up (wired through Skeleton's sandbox.ts).
 *
 * Public surface matches what patch-parser expects + what read/write/edit
 * file tools need.
 */

import fs from "node:fs";
import path from "node:path";
import { hasBinaryExtension } from "./binary-extensions.js";
import { fuzzyFindAndReplace } from "./fuzzy-match.js";
import {
  recordRead as stateRecordRead,
  noteWrite as stateNoteWrite,
  checkStale as stateCheckStale,
  lockPath as stateLockPath,
} from "./file-state.js";

// ── Result types (match Hermes dataclass shapes) ──────────────────────

export interface ReadResult {
  content: string;
  totalLines: number;
  fileSize: number;
  truncated: boolean;
  hint: string | null;
  isBinary: boolean;
  isImage: boolean;
  base64Content: string | null;
  mimeType: string | null;
  dimensions: string | null;
  error: string | null;
  similarFiles: string[];
}

export interface WriteResult {
  bytesWritten: number;
  dirsCreated: boolean;
  error: string | null;
  warning: string | null;
}

export interface SearchMatch {
  path: string;
  lineNumber: number;
  content: string;
  mtime: number;
}

export interface SearchResult {
  matches: SearchMatch[];
  files: string[];
  counts: Record<string, number>;
  totalCount: number;
  truncated: boolean;
  error: string | null;
}

function emptyRead(): ReadResult {
  return {
    content: "", totalLines: 0, fileSize: 0, truncated: false, hint: null,
    isBinary: false, isImage: false, base64Content: null, mimeType: null,
    dimensions: null, error: null, similarFiles: [],
  };
}

// ── Write safety ──────────────────────────────────────────────────────

function getSafeWriteRoot(): string | null {
  const root = process.env.SKELETON_WRITE_SAFE_ROOT;
  if (!root) return null;
  try {
    return fs.realpathSync(root);
  } catch {
    return root;
  }
}

const HOME = process.env.HOME || process.env.USERPROFILE || "";

/** Paths that writes always refuse. Matches Hermes write-deny list spirit. */
const DENIED_PATHS = new Set<string>([
  "/etc/passwd", "/etc/shadow", "/etc/sudoers",
  ...(HOME ? [
    path.join(HOME, ".ssh", "id_rsa"),
    path.join(HOME, ".ssh", "id_ed25519"),
    path.join(HOME, ".aws", "credentials"),
    path.join(HOME, ".skeleton", ".env"),
  ] : []),
]);

const DENIED_PREFIXES = [
  "/etc/sudoers.d/", "/etc/shadow.", "/boot/", "/sys/", "/proc/",
  ...(HOME ? [path.join(HOME, ".ssh") + path.sep] : []),
];

function isWriteDenied(target: string): boolean {
  let resolved: string;
  try {
    resolved = path.resolve(target);
  } catch {
    return false;
  }
  if (DENIED_PATHS.has(resolved)) return true;
  for (const prefix of DENIED_PREFIXES) {
    if (resolved.startsWith(prefix)) return true;
  }
  const safeRoot = getSafeWriteRoot();
  if (safeRoot) {
    const normalized = resolved + path.sep;
    const rootPrefix = safeRoot.endsWith(path.sep) ? safeRoot : safeRoot + path.sep;
    if (!normalized.startsWith(rootPrefix) && resolved !== safeRoot) return true;
  }
  return false;
}

// ── LocalFileOperations ───────────────────────────────────────────────

const DEFAULT_READ_LINES = 500;
const MAX_LINE_LENGTH = 2000;

export interface FileOpsContext {
  taskId?: string;        // For file-state guard
  maxLineLength?: number;
  maxReadChars?: number;
}

export class LocalFileOperations {
  constructor(private ctx: FileOpsContext = {}) {}

  /** Read file with pagination + line-number prefix + truncation per line. */
  readFile(filePath: string, offset = 1, limit = DEFAULT_READ_LINES): ReadResult {
    const r = emptyRead();
    const resolved = path.resolve(filePath);
    try {
      if (!fs.existsSync(resolved)) {
        r.error = `File not found: ${filePath}`;
        r.similarFiles = this.findSimilar(resolved);
        return r;
      }
      const stat = fs.statSync(resolved);
      r.fileSize = stat.size;
      if (stat.isDirectory()) {
        r.error = `Is a directory: ${filePath}`;
        return r;
      }
      if (hasBinaryExtension(filePath)) {
        r.isBinary = true;
        r.error = `Binary file: ${filePath} — use hexdump or read_file with offset/limit.`;
        return r;
      }

      const raw = fs.readFileSync(resolved, "utf-8");
      const lines = raw.split("\n");
      r.totalLines = lines.length;
      const maxLineLen = this.ctx.maxLineLength ?? MAX_LINE_LENGTH;

      const start = Math.max(1, offset) - 1;
      const end = Math.min(lines.length, start + limit);
      const slice = lines.slice(start, end);

      const truncated = end < lines.length || start > 0;
      r.truncated = truncated;
      if (truncated) r.hint = `Showing lines ${start + 1}-${end} of ${lines.length}. Use offset=${end + 1} to continue.`;

      // Line-number prefix + per-line length cap
      const prefixed = slice.map((line, i) => {
        const lineNo = start + i + 1;
        const capped = line.length > maxLineLen ? line.slice(0, maxLineLen) + "…" : line;
        return `${String(lineNo).padStart(6)}: ${capped}`;
      });
      r.content = prefixed.join("\n");

      if (this.ctx.taskId) {
        stateRecordRead(this.ctx.taskId, resolved, { partial: truncated });
      }
      return r;
    } catch (e) {
      r.error = (e as Error).message;
      return r;
    }
  }

  /** Read entire file, no prefixes, no pagination — for patch/fuzzy paths. */
  readFileRaw(filePath: string): ReadResult {
    const r = emptyRead();
    const resolved = path.resolve(filePath);
    try {
      if (!fs.existsSync(resolved)) {
        r.error = `File not found: ${filePath}`;
        return r;
      }
      const stat = fs.statSync(resolved);
      r.fileSize = stat.size;
      if (stat.isDirectory()) {
        r.error = `Is a directory: ${filePath}`;
        return r;
      }
      if (hasBinaryExtension(filePath)) {
        r.isBinary = true;
        r.error = `Binary file: ${filePath}`;
        return r;
      }
      r.content = fs.readFileSync(resolved, "utf-8");
      r.totalLines = r.content.split("\n").length;
      if (this.ctx.taskId) stateRecordRead(this.ctx.taskId, resolved);
      return r;
    } catch (e) {
      r.error = (e as Error).message;
      return r;
    }
  }

  writeFile(filePath: string, content: string): WriteResult {
    const r: WriteResult = { bytesWritten: 0, dirsCreated: false, error: null, warning: null };
    const resolved = path.resolve(filePath);

    if (isWriteDenied(resolved)) {
      r.error = `Write denied: ${filePath} is on the write-denied list or outside SKELETON_WRITE_SAFE_ROOT`;
      return r;
    }

    if (this.ctx.taskId) {
      const stale = stateCheckStale(this.ctx.taskId, resolved);
      if (stale) r.warning = stale;
    }

    try {
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        r.dirsCreated = true;
      }
      fs.writeFileSync(resolved, content, "utf-8");
      const buf = Buffer.from(content, "utf-8");
      r.bytesWritten = buf.length;
      if (this.ctx.taskId) stateNoteWrite(this.ctx.taskId, resolved);
      return r;
    } catch (e) {
      r.error = (e as Error).message;
      return r;
    }
  }

  deleteFile(filePath: string): { error: string | null } {
    const resolved = path.resolve(filePath);
    if (isWriteDenied(resolved)) return { error: `Delete denied: ${filePath}` };
    try {
      if (!fs.existsSync(resolved)) return { error: `File not found: ${filePath}` };
      fs.unlinkSync(resolved);
      return { error: null };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  moveFile(from: string, to: string): { error: string | null } {
    const src = path.resolve(from);
    const dst = path.resolve(to);
    if (isWriteDenied(src) || isWriteDenied(dst)) return { error: `Move denied` };
    try {
      if (!fs.existsSync(src)) return { error: `Source not found: ${from}` };
      if (fs.existsSync(dst)) return { error: `Destination exists: ${to}` };
      const dir = path.dirname(dst);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.renameSync(src, dst);
      return { error: null };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }

  /** Fuzzy edit with 9-strategy match. Returns new content + diff marker. */
  editFile(
    filePath: string,
    oldString: string,
    newString: string,
    replaceAll = false,
  ): { success: boolean; matchCount: number; strategy: string | null; error: string | null } {
    const read = this.readFileRaw(filePath);
    if (read.error) return { success: false, matchCount: 0, strategy: null, error: read.error };

    const res = fuzzyFindAndReplace(read.content, oldString, newString, replaceAll);
    if (res.error) return { success: false, matchCount: 0, strategy: null, error: res.error };

    const write = this.writeFile(filePath, res.newContent);
    if (write.error) return { success: false, matchCount: res.matchCount, strategy: res.strategy, error: write.error };

    return { success: true, matchCount: res.matchCount, strategy: res.strategy, error: null };
  }

  /** Acquire per-path lock for a read→modify→write critical section. */
  lockPath(filePath: string): Promise<() => void> {
    return stateLockPath(path.resolve(filePath));
  }

  /** Recursive grep-like search. pattern is a regex. */
  search(
    pattern: string,
    searchPath: string,
    opts: { fileGlob?: string; caseSensitive?: boolean; maxMatches?: number } = {},
  ): SearchResult {
    const result: SearchResult = {
      matches: [], files: [], counts: {}, totalCount: 0, truncated: false, error: null,
    };
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, opts.caseSensitive ? "g" : "gi");
    } catch (e) {
      result.error = `Invalid regex: ${(e as Error).message}`;
      return result;
    }
    const maxMatches = opts.maxMatches ?? 500;
    const glob = opts.fileGlob;

    const walk = (dir: string): void => {
      if (result.truncated) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch { return; }
      for (const e of entries) {
        if (result.truncated) return;
        if (e.name.startsWith(".")) continue;
        if (e.name === "node_modules" || e.name === "dist" || e.name === "__pycache__") continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.isFile()) {
          if (glob && !matchGlob(e.name, glob)) continue;
          if (hasBinaryExtension(e.name)) continue;
          let content: string;
          try { content = fs.readFileSync(full, "utf-8"); } catch { continue; }
          let stat: fs.Stats;
          try { stat = fs.statSync(full); } catch { continue; }
          const lines = content.split("\n");
          let fileMatchCount = 0;
          for (let i = 0; i < lines.length; i++) {
            regex.lastIndex = 0;
            if (regex.test(lines[i])) {
              fileMatchCount++;
              result.matches.push({
                path: full,
                lineNumber: i + 1,
                content: lines[i].length > MAX_LINE_LENGTH
                  ? lines[i].slice(0, MAX_LINE_LENGTH) + "…"
                  : lines[i],
                mtime: stat.mtimeMs,
              });
              result.totalCount++;
              if (result.matches.length >= maxMatches) {
                result.truncated = true;
                return;
              }
            }
          }
          if (fileMatchCount > 0) {
            result.counts[full] = fileMatchCount;
            result.files.push(full);
          }
        }
      }
    };

    try {
      const startDir = path.resolve(searchPath);
      const stat = fs.statSync(startDir);
      if (stat.isDirectory()) walk(startDir);
      else result.error = `Not a directory: ${searchPath}`;
    } catch (e) {
      result.error = (e as Error).message;
    }
    return result;
  }

  /** Suggest similar paths when a read target doesn't exist (typo recovery). */
  private findSimilar(target: string, limit = 5): string[] {
    const dir = path.dirname(target);
    const base = path.basename(target).toLowerCase();
    try {
      const entries = fs.readdirSync(dir);
      const scored = entries
        .map(e => ({ name: e, score: stringSimilarity(e.toLowerCase(), base) }))
        .filter(x => x.score >= 0.5)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map(x => path.join(dir, x.name));
      return scored;
    } catch {
      return [];
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function matchGlob(name: string, glob: string): boolean {
  // Minimal glob: "*" and "?" only. Sufficient for common cases like "*.ts".
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp("^" + escaped + "$").test(name);
}

function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  const dist = levenshtein(longer, shorter);
  return (longer.length - dist) / longer.length;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array(n + 1);
  const cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= n; j++) prev[j] = cur[j];
  }
  return prev[n];
}
