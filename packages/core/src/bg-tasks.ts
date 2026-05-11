/**
 * Background Task Manager — run long tasks in the background, track status.
 * Supports notify_on_complete: when a task finishes, the agent gets notified.
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
  completedAt?: string;
  pid?: number;
  exitCode?: number;
  output?: string;
  notifyOnComplete?: boolean;
}

export type BgTaskNotifyCallback = (task: BgTask) => void;

const BG_DATA_PATH = path.join(os.homedir(), ".skeleton", "bg-tasks.json");

export class BackgroundTaskManager {
  private tasks = new Map<string, BgTask>();
  private processes = new Map<string, ChildProcess>();
  private outputBuffers = new Map<string, string>();
  private notifyCallback: BgTaskNotifyCallback | null = null;

  /** Register a callback that fires when a task with notifyOnComplete finishes */
  onTaskComplete(cb: BgTaskNotifyCallback): void {
    this.notifyCallback = cb;
  }

  /** Start a background command */
  start(command: string, options?: { notifyOnComplete?: boolean; captureOutput?: boolean }): BgTask {
    const id = `bg_${Date.now().toString(36)}`;
    const captureOutput = options?.captureOutput ?? (options?.notifyOnComplete ?? false);
    const task: BgTask = {
      id,
      command,
      status: "running",
      startedAt: new Date().toISOString(),
      notifyOnComplete: options?.notifyOnComplete ?? false,
    };

    const proc = spawn(command, [], {
      shell: true,
      detached: true,
      stdio: captureOutput ? ["ignore", "pipe", "pipe"] : "ignore",
    });
    if (!captureOutput) proc.unref();

    task.pid = proc.pid;
    this.tasks.set(id, task);
    this.processes.set(id, proc);

    if (captureOutput) {
      this.outputBuffers.set(id, "");
      proc.stdout?.on("data", (d: Buffer) => {
        const buf = this.outputBuffers.get(id) ?? "";
        this.outputBuffers.set(id, (buf + d.toString()).slice(-10000));
      });
      proc.stderr?.on("data", (d: Buffer) => {
        const buf = this.outputBuffers.get(id) ?? "";
        this.outputBuffers.set(id, (buf + d.toString()).slice(-10000));
      });
    }

    proc.on("exit", (code) => {
      const t = this.tasks.get(id);
      if (t) {
        t.status = code === 0 ? "completed" : "failed";
        t.exitCode = code ?? -1;
        t.completedAt = new Date().toISOString();
        t.output = this.outputBuffers.get(id)?.slice(-2000) ?? undefined;
        this.outputBuffers.delete(id);
        this.processes.delete(id);
        this.save();

        if (t.notifyOnComplete && this.notifyCallback) {
          this.notifyCallback(t);
        }
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

  /** Get output buffer for a running task */
  getOutput(id: string): string {
    return this.outputBuffers.get(id) ?? this.tasks.get(id)?.output ?? "";
  }

  /** Kill a running task */
  kill(id: string): boolean {
    const proc = this.processes.get(id);
    if (!proc) return false;
    try {
      proc.kill("SIGTERM");
      const task = this.tasks.get(id);
      if (task) { task.status = "failed"; task.exitCode = -1; task.completedAt = new Date().toISOString(); }
      this.processes.delete(id);
      this.outputBuffers.delete(id);
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
