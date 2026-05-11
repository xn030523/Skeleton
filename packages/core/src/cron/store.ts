import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { atomicWriteJsonSync } from "../atomic-write.js";

export type ScheduleFormat =
  | { type: "cron"; expression: string }       // standard 5-field cron
  | { type: "interval"; seconds: number }      // every N seconds
  | { type: "duration"; seconds: number }      // once after N seconds
  | { type: "timestamp"; date: string };       // once at ISO date

export type DeliveryTarget = "cli" | "telegram" | "webhook";

export interface CronJob {
  id: string;
  name: string;
  schedule: ScheduleFormat;
  prompt: string;                // prompt to send to Agent when job fires
  enabled: boolean;
  delivery: DeliveryTarget[];
  webhookUrl?: string;
  lastRun?: string;              // ISO timestamp
  nextRun?: string;              // ISO timestamp
  runCount: number;
  createdAt: string;
  context?: string;              // optional context to chain between runs
  noAgent?: boolean;             // if true, execute command directly without LLM
  silent?: boolean;              // if true, suppress delivery notifications
  command?: string;              // shell command for noAgent mode
}

interface JobStore {
  version: number;
  jobs: CronJob[];
}

export class CronStore {
  private filePath: string;
  private store: JobStore;

  constructor(storePath?: string) {
    this.filePath = storePath ?? path.join(os.homedir(), ".skeleton", "cron", "jobs.json");
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    this.store = this.loadDisk();
  }

  add(job: Omit<CronJob, "id" | "runCount" | "createdAt" | "lastRun" | "nextRun">): CronJob {
    const full: CronJob = {
      ...job,
      id: generateId(),
      runCount: 0,
      createdAt: new Date().toISOString(),
      nextRun: computeNextRun(job.schedule),
    };
    this.store.jobs.push(full);
    this.saveDisk();
    return full;
  }

  get(id: string): CronJob | undefined {
    return this.store.jobs.find((j) => j.id === id);
  }

  list(enabledOnly = false): CronJob[] {
    return enabledOnly
      ? this.store.jobs.filter((j) => j.enabled)
      : [...this.store.jobs];
  }

  update(id: string, patch: Partial<Pick<CronJob, "name" | "schedule" | "prompt" | "enabled" | "delivery" | "webhookUrl" | "context" | "noAgent" | "silent" | "command">>): CronJob | null {
    const idx = this.store.jobs.findIndex((j) => j.id === id);
    if (idx === -1) return null;
    Object.assign(this.store.jobs[idx], patch);
    if (patch.schedule) {
      this.store.jobs[idx].nextRun = computeNextRun(patch.schedule);
    }
    this.saveDisk();
    return this.store.jobs[idx];
  }

  remove(id: string): boolean {
    const idx = this.store.jobs.findIndex((j) => j.id === id);
    if (idx === -1) return false;
    this.store.jobs.splice(idx, 1);
    this.saveDisk();
    return true;
  }

  markRun(id: string, context?: string): void {
    const job = this.store.jobs.find((j) => j.id === id);
    if (!job) return;
    job.lastRun = new Date().toISOString();
    job.runCount++;
    if (context !== undefined) job.context = context;
    // For duration/timestamp: disable after first run
    if (job.schedule.type === "duration" || job.schedule.type === "timestamp") {
      job.enabled = false;
      job.nextRun = undefined;
    } else {
      job.nextRun = computeNextRun(job.schedule);
    }
    this.saveDisk();
  }

  private loadDisk(): JobStore {
    if (!fs.existsSync(this.filePath)) return { version: 1, jobs: [] };
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      return JSON.parse(raw) as JobStore;
    } catch {
      return { version: 1, jobs: [] };
    }
  }

  private saveDisk(): void {
    atomicWriteJsonSync(this.filePath, this.store);
  }
}

function generateId(): string {
  return `cron_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function computeNextRun(schedule: ScheduleFormat): string | undefined {
  const now = Date.now();
  switch (schedule.type) {
    case "duration":
      return new Date(now + schedule.seconds * 1000).toISOString();
    case "timestamp":
      return schedule.date;
    case "interval":
      return new Date(now + schedule.seconds * 1000).toISOString();
    case "cron":
      // Simplified: use 60s tick loop, cron parsing done by scheduler
      return new Date(now + 60_000).toISOString();
  }
}
