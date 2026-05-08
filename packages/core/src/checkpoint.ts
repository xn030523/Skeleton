/**
 * Checkpoint manager — transparent filesystem snapshots via
 * shared shadow git store. Auto-snapshot before file mutations.
 * Supports rollback to any previous snapshot.
 *
 * Inspired by Hermes checkpoint_manager.py (simplified).
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

export class CheckpointManager {
  private shadowRepo: string;
  private snapshots: Array<{ id: string; message: string; timestamp: number; cwd: string }> = [];
  private nextId = 1;

  constructor(private cwd: string = process.cwd()) {
    this.shadowRepo = path.join(cwd, ".skeleton", "checkpoints");
    fs.mkdirSync(this.shadowRepo, { recursive: true });
    this.initShadowRepo();
  }

  /** Initialize shadow git repo for snapshots */
  private initShadowRepo(): void {
    if (!fs.existsSync(path.join(this.shadowRepo, ".git"))) {
      try {
        execSync("git init", { cwd: this.shadowRepo, encoding: "utf-8" });
        execSync('git config user.name "Skeleton Checkpoint"', { cwd: this.shadowRepo, encoding: "utf-8" });
        execSync('git config user.email "checkpoint@skeleton.local"', { cwd: this.shadowRepo, encoding: "utf-8" });
      } catch {
        // Shadow repo init failed — checkpoints will be unavailable
      }
    }
  }

  /** Create a checkpoint before a file mutation */
  async snapshot(filePath: string, message?: string): Promise<string | null> {
    const absPath = path.resolve(this.cwd, filePath);
    if (!fs.existsSync(absPath)) return null;

    const relPath = path.relative(this.cwd, filePath);
    const destDir = path.join(this.shadowRepo, path.dirname(relPath));
    fs.mkdirSync(destDir, { recursive: true });
    const destPath = path.join(this.shadowRepo, relPath);

    try {
      fs.copyFileSync(absPath, destPath);

      // Stage and commit in shadow repo
      execSync(`git add -A`, { cwd: this.shadowRepo, encoding: "utf-8" });
      const id = `snap_${this.nextId++}`;
      const commitMsg = message ?? `checkpoint: ${relPath}`;
      execSync(`git commit -m "${commitMsg.replace(/"/g, '\\"')}" --allow-empty`, {
        cwd: this.shadowRepo,
        encoding: "utf-8",
      });

      this.snapshots.push({
        id,
        message: commitMsg,
        timestamp: Date.now(),
        cwd: this.cwd,
      });

      return id;
    } catch {
      return null;
    }
  }

  /** Rollback to the most recent checkpoint */
  async rollback(): Promise<{ success: boolean; message: string }> {
    if (this.snapshots.length === 0) {
      return { success: false, message: "No checkpoints available for rollback" };
    }

    try {
      // Revert last commit in shadow repo
      execSync("git revert HEAD --no-edit", { cwd: this.shadowRepo, encoding: "utf-8" });

      // Copy files back from shadow repo to working directory
      const lastSnap = this.snapshots[this.snapshots.length - 1];
      this.copyShadowToWorking();

      this.snapshots.pop();
      return { success: true, message: `Rolled back to before: ${lastSnap.message}` };
    } catch (err) {
      return { success: false, message: `Rollback failed: ${(err as Error).message}` };
    }
  }

  /** List all checkpoints */
  list(): Array<{ id: string; message: string; timestamp: number }> {
    return [...this.snapshots];
  }

  /** Copy modified files from shadow repo back to working directory */
  private copyShadowToWorking(): void {
    try {
      const diff = execSync("git diff HEAD~1 --name-only", {
        cwd: this.shadowRepo,
        encoding: "utf-8",
      });
      const files = diff.trim().split("\n").filter(Boolean);

      for (const file of files) {
        const src = path.join(this.shadowRepo, file);
        const dest = path.join(this.cwd, file);
        if (fs.existsSync(src)) {
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fs.copyFileSync(src, dest);
        }
      }
    } catch {
      // Nothing to copy
    }
  }
}
