/**
 * Cross-agent file state coordination.
 *
 * Port of Hermes `tools/file_state.py`. Prevents mangled edits when
 * concurrent sub-agents (same process, same filesystem) touch the same
 * file. Complements the single-agent path-overlap check — this module
 * catches the case where subagent B writes a file that subagent A already
 * read, so A's next write would overwrite B's changes with stale content.
 *
 * Three public hooks used by file tools:
 *   - recordRead(taskId, path, {partial})  — called by read_file
 *   - noteWrite(taskId, path)               — called after write/patch
 *   - checkStale(taskId, path)              — called BEFORE write/patch
 *
 * Plus `lockPath(path)` — returns an async lock handle scoped to one
 * resolved path. Use to wrap the whole read→modify→write critical section.
 *
 * Node is single-threaded so `threading.Lock` becomes a Promise-based
 * async mutex (serialize overlapping async operations on same path).
 *
 * Disabled when SKELETON_DISABLE_FILE_STATE_GUARD=1.
 */

import fs from "node:fs";

/** (mtime, readTs, partial) tuple. */
type ReadStamp = [number, number, boolean];

const MAX_PATHS_PER_AGENT = 4096;
const MAX_GLOBAL_WRITERS = 4096;

function isDisabled(): boolean {
  return (process.env.SKELETON_DISABLE_FILE_STATE_GUARD ?? "").trim() === "1";
}

function capMap<K, V>(map: Map<K, V>, limit: number): void {
  const over = map.size - limit;
  if (over <= 0) return;
  let dropped = 0;
  for (const key of map.keys()) {
    if (dropped >= over) break;
    map.delete(key);
    dropped++;
  }
}

function fmtTs(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

/** Per-path async mutex. Used to serialize overlapping operations on the same file. */
class AsyncMutex {
  private queue: Array<() => void> = [];
  private locked = false;

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      const release = () => {
        const next = this.queue.shift();
        if (next) next();
        else this.locked = false;
      };
      if (!this.locked) {
        this.locked = true;
        resolve(release);
      } else {
        this.queue.push(() => resolve(release));
      }
    });
  }
}

export class FileStateRegistry {
  // taskId → path → ReadStamp
  private reads: Map<string, Map<string, ReadStamp>> = new Map();
  // path → [taskId, writeTs]
  private lastWriter: Map<string, [string, number]> = new Map();
  // path → AsyncMutex
  private pathLocks: Map<string, AsyncMutex> = new Map();

  private mutexFor(resolved: string): AsyncMutex {
    let m = this.pathLocks.get(resolved);
    if (!m) {
      m = new AsyncMutex();
      this.pathLocks.set(resolved, m);
    }
    return m;
  }

  /** Acquire per-path lock. Usage: `const release = await reg.lockPath(p); try { ... } finally { release(); }` */
  async lockPath(resolved: string): Promise<() => void> {
    return this.mutexFor(resolved).acquire();
  }

  recordRead(taskId: string, resolved: string, opts: { partial?: boolean; mtime?: number } = {}): void {
    if (isDisabled()) return;
    let mtime = opts.mtime;
    if (mtime === undefined) {
      try {
        mtime = fs.statSync(resolved).mtimeMs;
      } catch {
        return;
      }
    }
    const now = Date.now();
    let agentReads = this.reads.get(taskId);
    if (!agentReads) {
      agentReads = new Map();
      this.reads.set(taskId, agentReads);
    }
    agentReads.set(resolved, [mtime, now, Boolean(opts.partial)]);
    capMap(agentReads, MAX_PATHS_PER_AGENT);
  }

  /** A write is an implicit read — updates this agent's stamp too. */
  noteWrite(taskId: string, resolved: string, opts: { mtime?: number } = {}): void {
    if (isDisabled()) return;
    let mtime = opts.mtime;
    if (mtime === undefined) {
      try {
        mtime = fs.statSync(resolved).mtimeMs;
      } catch {
        return;
      }
    }
    const now = Date.now();
    this.lastWriter.set(resolved, [taskId, now]);
    capMap(this.lastWriter, MAX_GLOBAL_WRITERS);

    let agentReads = this.reads.get(taskId);
    if (!agentReads) {
      agentReads = new Map();
      this.reads.set(taskId, agentReads);
    }
    agentReads.set(resolved, [mtime, now, false]);
    capMap(agentReads, MAX_PATHS_PER_AGENT);
  }

  /** Return a warning string if writing would clobber stale/unknown content. */
  checkStale(taskId: string, resolved: string): string | null {
    if (isDisabled()) return null;
    const stamp = this.reads.get(taskId)?.get(resolved);
    const lastWriter = this.lastWriter.get(resolved);

    // Case 3a: never read + never written anywhere — fresh file, nothing to warn.
    if (!stamp && !lastWriter) return null;

    let currentMtime: number;
    try {
      currentMtime = fs.statSync(resolved).mtimeMs;
    } catch {
      // File doesn't exist — write will create it; not stale.
      return null;
    }

    // Case 1: sibling subagent modified after our last read.
    if (lastWriter) {
      const [writerTid, writerTs] = lastWriter;
      if (writerTid !== taskId) {
        if (!stamp) {
          return (
            `${resolved} was modified by sibling subagent '${writerTid}' ` +
            `but this agent never read it. Read the file before writing to ` +
            `avoid overwriting the sibling's changes.`
          );
        }
        const [, readTs] = stamp;
        if (writerTs > readTs) {
          return (
            `${resolved} was modified by sibling subagent '${writerTid}' at ` +
            `${fmtTs(writerTs)} — after this agent's last read at ${fmtTs(readTs)}. ` +
            `Re-read the file before writing.`
          );
        }
      }
    }

    // Case 2: external / unknown modification (mtime drifted).
    if (stamp) {
      const [readMtime, , partial] = stamp;
      if (currentMtime !== readMtime) {
        return (
          `${resolved} was modified since you last read it on disk ` +
          `(external edit or unrecorded writer). Re-read the file before writing.`
        );
      }
      if (partial) {
        return (
          `${resolved} was last read with offset/limit pagination ` +
          `(partial view). Re-read the whole file before overwriting it.`
        );
      }
    }

    // Case 3b: agent truly never read the file.
    if (!stamp) {
      return (
        `${resolved} was not read by this agent. ` +
        `Read the file first so you can write an informed edit.`
      );
    }

    return null;
  }

  writesSince(
    excludeTaskId: string,
    sinceTs: number,
    paths: Iterable<string>,
  ): Record<string, string[]> {
    if (isDisabled()) return {};
    const pathsSet = new Set(paths);
    const out: Record<string, string[]> = {};
    for (const [p, [writerTid, ts]] of this.lastWriter) {
      if (writerTid === excludeTaskId) continue;
      if (ts < sinceTs) continue;
      if (!pathsSet.has(p)) continue;
      if (!out[writerTid]) out[writerTid] = [];
      out[writerTid].push(p);
    }
    return out;
  }

  knownReads(taskId: string): string[] {
    if (isDisabled()) return [];
    return Array.from(this.reads.get(taskId)?.keys() ?? []);
  }

  /** Test-only: reset state. */
  clear(): void {
    this.reads.clear();
    this.lastWriter.clear();
    this.pathLocks.clear();
  }
}

// ── Module-level singleton ──────────────────────────────────────────
const registry = new FileStateRegistry();

export function getFileStateRegistry(): FileStateRegistry {
  return registry;
}

// Convenience wrappers matching Hermes' short names.
export function recordRead(taskId: string, path: string, opts: { partial?: boolean } = {}): void {
  registry.recordRead(taskId, path, opts);
}

export function noteWrite(taskId: string, path: string): void {
  registry.noteWrite(taskId, path);
}

export function checkStale(taskId: string, path: string): string | null {
  return registry.checkStale(taskId, path);
}

export function lockPath(path: string): Promise<() => void> {
  return registry.lockPath(path);
}
