import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { MemoryStore } from "./memory/store.js";
import type { SessionDB } from "./session/index.js";
import type { GoalManager } from "./goals/index.js";

const SKELETON_DIR = path.join(os.homedir(), ".skeleton");
const SNAPSHOTS_DIR = path.join(SKELETON_DIR, "snapshots");

export interface SnapshotMeta {
  id: string;
  name: string;
  createdAt: string;
  messageCount: number;
  memoryCount: number;
  hasGoal: boolean;
}

export class SnapshotManager {
  private snapshotsDir: string;

  constructor(dir?: string) {
    this.snapshotsDir = dir ?? SNAPSHOTS_DIR;
  }

  /** Create a snapshot from current session state */
  create(
    name: string,
    opts: {
      messages: Array<{ role: string; content: string }>;
      memory: MemoryStore | null;
      sessionDb: SessionDB | null;
      sessionId: string;
      goalManager: GoalManager | null;
      goalSessionId: string;
    },
  ): SnapshotMeta {
    fs.mkdirSync(this.snapshotsDir, { recursive: true });

    const id = `snap_${Date.now().toString(36)}`;
    const snapDir = path.join(this.snapshotsDir, id);
    fs.mkdirSync(snapDir, { recursive: true });

    // Save metadata
    const meta: SnapshotMeta = {
      id,
      name,
      createdAt: new Date().toISOString(),
      messageCount: opts.messages.length,
      memoryCount: opts.memory?.list().length ?? 0,
      hasGoal: opts.goalManager?.hasActiveGoal(opts.goalSessionId) ?? false,
    };
    fs.writeFileSync(path.join(snapDir, "meta.json"), JSON.stringify(meta, null, 2), "utf-8");

    // Save messages
    if (opts.messages.length > 0) {
      fs.writeFileSync(
        path.join(snapDir, "messages.json"),
        JSON.stringify(opts.messages, null, 2),
        "utf-8",
      );
    }

    // Save memories
    if (opts.memory) {
      const memories = opts.memory.list();
      if (memories.length > 0) {
        fs.writeFileSync(
          path.join(snapDir, "memories.json"),
          JSON.stringify(memories, null, 2),
          "utf-8",
        );
      }
    }

    // Save goal state
    if (opts.goalManager) {
      const goal = opts.goalManager.getGoal(opts.goalSessionId);
      if (goal) {
        fs.writeFileSync(
          path.join(snapDir, "goal.json"),
          JSON.stringify(goal, null, 2),
          "utf-8",
        );
      }
    }

    // Save config.yaml snapshot if exists
    const configPath = path.join(SKELETON_DIR, "config.yaml");
    if (fs.existsSync(configPath)) {
      fs.copyFileSync(configPath, path.join(snapDir, "config.yaml"));
    }

    return meta;
  }

  /** List all snapshots */
  list(): SnapshotMeta[] {
    if (!fs.existsSync(this.snapshotsDir)) return [];
    const results: SnapshotMeta[] = [];
    for (const entry of fs.readdirSync(this.snapshotsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const metaPath = path.join(this.snapshotsDir, entry.name, "meta.json");
      try {
        const raw = fs.readFileSync(metaPath, "utf-8");
        results.push(JSON.parse(raw) as SnapshotMeta);
      } catch { /* skip malformed */ }
    }
    return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Get snapshot details */
  get(id: string): SnapshotMeta | null {
    const metaPath = path.join(this.snapshotsDir, id, "meta.json");
    try {
      return JSON.parse(fs.readFileSync(metaPath, "utf-8")) as SnapshotMeta;
    } catch {
      return null;
    }
  }

  /** Restore messages from a snapshot */
  restoreMessages(id: string): Array<{ role: string; content: string }> | null {
    const filePath = path.join(this.snapshotsDir, id, "messages.json");
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      return null;
    }
  }

  /** Restore memories from a snapshot (returns entries, caller applies them) */
  restoreMemories(id: string): unknown[] | null {
    const filePath = path.join(this.snapshotsDir, id, "memories.json");
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      return null;
    }
  }

  /** Restore goal from a snapshot */
  restoreGoal(id: string): unknown | null {
    const filePath = path.join(this.snapshotsDir, id, "goal.json");
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf-8"));
    } catch {
      return null;
    }
  }

  /** Delete a snapshot */
  delete(id: string): boolean {
    const snapDir = path.join(this.snapshotsDir, id);
    if (!fs.existsSync(snapDir)) return false;
    fs.rmSync(snapDir, { recursive: true, force: true });
    return true;
  }

  /** Prune snapshots older than N days */
  prune(olderThanDays = 30): number {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - olderThanDays);
    const cutoffStr = cutoff.toISOString();

    let pruned = 0;
    for (const meta of this.list()) {
      if (meta.createdAt < cutoffStr) {
        this.delete(meta.id);
        pruned++;
      }
    }
    return pruned;
  }
}
