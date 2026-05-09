/**
 * Process Registry — managed background process tracking with
 * output buffering, status polling, crash recovery, and session-scoped cleanup.
 *
 * Inspired by Hermes process_registry.py (simplified — Node.js ChildProcess).
 */

import { spawn, type ChildProcess } from "node:child_process";

const MAX_OUTPUT_BYTES = 200_000; // 200KB rolling buffer

export interface ProcessEntry {
  id: string;
  command: string;
  args: string[];
  pid?: number;
  status: "running" | "exited" | "crashed" | "killed";
  exitCode?: number;
  startedAt: number;
  output: string;
  error: string;
}

export class ProcessRegistry {
  private processes = new Map<string, ProcessEntry>();
  private nextId = 1;

  /** Spawn a background process and register it */
  spawn(
    command: string,
    args: string[] = [],
    options?: { cwd?: string; env?: Record<string, string> },
  ): ProcessEntry {
    const id = `proc_${this.nextId++}`;
    const entry: ProcessEntry = {
      id,
      command,
      args,
      status: "running",
      startedAt: Date.now(),
      output: "",
      error: "",
    };

    const child = spawn(command, args, {
      cwd: options?.cwd,
      env: { ...process.env, ...options?.env },
      detached: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    entry.pid = child.pid;

    child.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      entry.output += chunk;
      // Rolling buffer: trim to max size
      if (entry.output.length > MAX_OUTPUT_BYTES) {
        entry.output = entry.output.slice(-MAX_OUTPUT_BYTES);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      entry.error += chunk;
      if (entry.error.length > MAX_OUTPUT_BYTES) {
        entry.error = entry.error.slice(-MAX_OUTPUT_BYTES);
      }
    });

    child.on("exit", (code, signal) => {
      if (signal === "SIGKILL" || signal === "SIGTERM") {
        entry.status = "killed";
      } else if (code === 0) {
        entry.status = "exited";
      } else {
        entry.status = "crashed";
      }
      entry.exitCode = code ?? -1;
    });

    child.on("error", (err) => {
      entry.status = "crashed";
      entry.error += `\nProcess error: ${err.message}`;
    });

    this.processes.set(id, entry);
    return entry;
  }

  /** Get a process entry by ID */
  get(id: string): ProcessEntry | null {
    return this.processes.get(id) ?? null;
  }

  /** List all processes, optionally filtered by status */
  list(status?: ProcessEntry["status"]): ProcessEntry[] {
    const all = [...this.processes.values()];
    return status ? all.filter(p => p.status === status) : all;
  }

  /** Kill a running process */
  kill(id: string): boolean {
    const entry = this.processes.get(id);
    if (!entry || entry.status !== "running") return false;
    // Find and kill the actual process
    try {
      if (entry.pid) process.kill(entry.pid, "SIGTERM");
    } catch { /* already dead */ }
    entry.status = "killed";
    return true;
  }

  /** Wait for a process to exit, return final entry */
  async wait(id: string, timeoutMs: number = 30000): Promise<ProcessEntry | null> {
    const entry = this.processes.get(id);
    if (!entry) return null;
    if (entry.status !== "running") return entry;

    return new Promise((resolve) => {
      const deadline = Date.now() + timeoutMs;
      const check = () => {
        if (entry.status !== "running" || Date.now() > deadline) {
          if (entry.status === "running") this.kill(id);
          resolve(entry);
        } else {
          setTimeout(check, 200);
        }
      };
      check();
    });
  }

  /** Clean up all processes for this session */
  cleanup(): void {
    for (const entry of this.processes.values()) {
      if (entry.status === "running") {
        try {
          if (entry.pid) process.kill(entry.pid, "SIGTERM");
        } catch { /* already dead */ }
        entry.status = "killed";
      }
    }
  }
}
