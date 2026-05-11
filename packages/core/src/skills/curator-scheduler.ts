/**
 * Curator Scheduler — idle-based auto-trigger for SkillCurator.
 *
 * Mirrors Hermes' maybe_run_curator() pattern:
 *   - Enabled by default; users can pause via setPaused(true)
 *   - First observation seeds last_run_at to now (deferred first real pass)
 *   - Subsequent runs gated by interval_hours AND min_idle_seconds
 *   - State persisted in ~/.skeleton/skills/.curator_state.json
 *
 * Call onUserActivity() whenever the user sends a message. The scheduler
 * notes the activity; a separate tick() call decides whether to fire.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { SkillCurator, CuratorReport } from "./curator.js";

const DEFAULT_INTERVAL_HOURS = 24 * 7;   // 7 days
const DEFAULT_MIN_IDLE_MINUTES = 15;
const STATE_PATH = path.join(os.homedir(), ".skeleton", "skills", ".curator_state.json");

export interface CuratorState {
  lastRunAt: string | null;        // ISO timestamp
  lastRunSummary: string | null;
  lastRunDurationMs: number | null;
  paused: boolean;
  runCount: number;
}

export interface CuratorSchedulerOptions {
  intervalHours?: number;
  minIdleMinutes?: number;
  staleDays?: number;
}

function defaultState(): CuratorState {
  return {
    lastRunAt: null,
    lastRunSummary: null,
    lastRunDurationMs: null,
    paused: false,
    runCount: 0,
  };
}

export class CuratorScheduler {
  private curator: SkillCurator;
  private intervalMs: number;
  private minIdleMs: number;
  private staleDays: number;
  private lastActivityAt: number = Date.now();
  private running = false;

  constructor(curator: SkillCurator, opts: CuratorSchedulerOptions = {}) {
    this.curator = curator;
    this.intervalMs = (opts.intervalHours ?? DEFAULT_INTERVAL_HOURS) * 3600 * 1000;
    this.minIdleMs = (opts.minIdleMinutes ?? DEFAULT_MIN_IDLE_MINUTES) * 60 * 1000;
    this.staleDays = opts.staleDays ?? 30;
  }

  /** Record user activity to reset idle clock */
  onUserActivity(): void {
    this.lastActivityAt = Date.now();
  }

  loadState(): CuratorState {
    if (!fs.existsSync(STATE_PATH)) return defaultState();
    try {
      const raw = fs.readFileSync(STATE_PATH, "utf-8");
      const parsed = JSON.parse(raw);
      return { ...defaultState(), ...parsed };
    } catch {
      return defaultState();
    }
  }

  saveState(state: CuratorState): void {
    try {
      fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
      fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), "utf-8");
    } catch {
      // non-critical
    }
  }

  setPaused(paused: boolean): void {
    const state = this.loadState();
    state.paused = paused;
    this.saveState(state);
  }

  isPaused(): boolean {
    return this.loadState().paused;
  }

  /** Check static gates (enabled, paused, interval elapsed). Idle check done at call site. */
  private shouldRun(now: number = Date.now()): boolean {
    const state = this.loadState();
    if (state.paused) return false;

    if (!state.lastRunAt) {
      // First observation: seed and defer one interval
      state.lastRunAt = new Date(now).toISOString();
      state.lastRunSummary = "seeded — first real pass deferred by one interval";
      this.saveState(state);
      return false;
    }

    const lastMs = Date.parse(state.lastRunAt);
    if (Number.isNaN(lastMs)) return false;
    return now - lastMs >= this.intervalMs;
  }

  /** Returns true if user has been idle long enough to run curator without disrupting them */
  private isIdleEnough(now: number = Date.now()): boolean {
    return now - this.lastActivityAt >= this.minIdleMs;
  }

  /**
   * Attempt a curator pass. Returns the report if it ran, null if gates/idle blocked it.
   * Concurrency-safe: second call while running returns null.
   */
  async tick(): Promise<CuratorReport | null> {
    if (this.running) return null;
    const now = Date.now();
    if (!this.shouldRun(now)) return null;
    if (!this.isIdleEnough(now)) return null;

    this.running = true;
    const startedAt = Date.now();
    try {
      const report = this.curator.run({ staleDays: this.staleDays });
      const state = this.loadState();
      state.lastRunAt = new Date(startedAt).toISOString();
      state.lastRunDurationMs = Date.now() - startedAt;
      state.lastRunSummary = this.summarize(report);
      state.runCount += 1;
      this.saveState(state);
      return report;
    } finally {
      this.running = false;
    }
  }

  /** Force a run regardless of gates (for /curator run) */
  async forceRun(): Promise<CuratorReport> {
    const startedAt = Date.now();
    const report = this.curator.run({ staleDays: this.staleDays });
    const state = this.loadState();
    state.lastRunAt = new Date(startedAt).toISOString();
    state.lastRunDurationMs = Date.now() - startedAt;
    state.lastRunSummary = this.summarize(report);
    state.runCount += 1;
    this.saveState(state);
    return report;
  }

  private summarize(report: CuratorReport): string {
    const parts: string[] = [`${report.totalSkills} skills`];
    if (report.autoFixed > 0) parts.push(`${report.autoFixed} auto-fixed`);
    if (report.duplicates.length > 0) parts.push(`${report.duplicates.length} dup pairs`);
    if (report.stale.length > 0) parts.push(`${report.stale.length} stale`);
    if (report.orphanedFiles.length > 0) parts.push(`${report.orphanedFiles.length} orphans`);
    return parts.join(", ");
  }
}
