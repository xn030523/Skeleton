import type { CronJob } from "./store.js";
import { CronStore } from "./store.js";
import { shouldFire } from "./parser.js";
import { scanContextContent } from "../tools/prompt-security.js";

export type JobExecutor = (job: CronJob) => Promise<string>;

export class CronScheduler {
  private store: CronStore;
  private executor: JobExecutor;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(store: CronStore, executor: JobExecutor) {
    this.store = store;
    this.executor = executor;
  }

  /** Start the 60-second tick loop */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => this.tick(), 60_000);
    this.tick();
  }

  /** Stop the scheduler */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  isRunning(): boolean {
    return this.running;
  }

  private async tick(): Promise<void> {
    const now = new Date();
    const jobs = this.store.list(true);

    for (const job of jobs) {
      if (!shouldFire(job, now)) continue;

      // Scan assembled prompt for injection patterns before execution
      const scanResult = scanContextContent(job.prompt, `cron:${job.name}`);
      if (!scanResult.safe) {
        const warnings = scanResult.warnings.join("; ");
        console.warn(`[Cron] Job "${job.name}" prompt injection detected: ${warnings}`);
        this.store.markRun(job.id, `BLOCKED: prompt injection detected — ${warnings}`);
        continue;
      }

      try {
        const result = await this.executor(job);
        this.store.markRun(job.id, result.slice(0, 500));
      } catch (err) {
        this.store.markRun(job.id, `ERROR: ${(err as Error).message}`);
      }
    }
  }

  /** Convenience: add a job via the store */
  addJob(job: Parameters<CronStore["add"]>[0]): CronJob {
    return this.store.add(job);
  }

  /** Convenience: list jobs */
  listJobs(enabledOnly = false): CronJob[] {
    return this.store.list(enabledOnly);
  }

  /** Convenience: remove a job */
  removeJob(id: string): boolean {
    return this.store.remove(id);
  }
}
