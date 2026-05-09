/**
 * Background Task Manager — run long tasks in the background, track status.
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface BgTask {
  id: string;
  command: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  pid?: number;
  exitCode?: number;
  output?: string;
}

const BG_DATA_PATH = path.join(os.homedir(), ".skeleton", "bg-tasks.json");

export class BackgroundTaskManager {
  private tasks = new Map<string, BgTask>();
  private processes = new Map<string, ChildProcess>();

  /** Start a background command */
  start(command: string): BgTask {
    const id = `bg_${Date.now().toString(36)}`;
    const task: BgTask = {
      id,
      command,
      status: "running",
      startedAt: new Date().toISOString(),
    };

    const proc = spawn(command, [], {
      shell: true,
      detached: true,
      stdio: "ignore",
    });
    proc.unref();

    task.pid = proc.pid;
    this.tasks.set(id, task);
    this.processes.set(id, proc);

    // Track completion
    proc.on("exit", (code) => {
      const t = this.tasks.get(id);
      if (t) {
        t.status = code === 0 ? "completed" : "failed";
        t.exitCode = code ?? -1;
        this.processes.delete(id);
        this.save();
      }
    });

    this.save();
    return task;
  }

  /** List all background tasks */
  list(): BgTask[] {
    return [...this.tasks.values()].sort((a, b) =>
      b.startedAt.localeCompare(a.startedAt),
    );
  }

  /** Get a specific task */
  get(id: string): BgTask | undefined {
    return this.tasks.get(id);
  }

  /** Kill a running task */
  kill(id: string): boolean {
    const proc = this.processes.get(id);
    if (!proc) return false;
    try {
      proc.kill("SIGTERM");
      const task = this.tasks.get(id);
      if (task) { task.status = "failed"; task.exitCode = -1; }
      this.processes.delete(id);
      this.save();
      return true;
    } catch {
      return false;
    }
  }

  /** Clean up completed/failed tasks */
  prune(): number {
    let count = 0;
    for (const [id, task] of this.tasks) {
      if (task.status !== "running") {
        this.tasks.delete(id);
        count++;
      }
    }
    this.save();
    return count;
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(BG_DATA_PATH), { recursive: true });
      const data = [...this.tasks.values()];
      fs.writeFileSync(BG_DATA_PATH, JSON.stringify(data, null, 2), "utf-8");
    } catch { /* non-critical */ }
  }
}
