import type { CronJob } from "./store.js";
import { CronStore } from "./store.js";
import { shouldFire } from "./parser.js";

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
    // Run first tick immediately
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
    const jobs = this.store.list(true); // enabled only

    for (const job of jobs) {
      if (!shouldFire(job, now)) continue;

      try {
        const result = await this.executor(job);
        this.store.markRun(job.id, result.slice(0, 500));
      } catch (err) {
        // Mark as run even on failure (at-most-once)
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
