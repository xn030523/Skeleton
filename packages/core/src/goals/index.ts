/**
 * Goals System — Hermes-style Ralph Loop for autonomous multi-turn work.
 *
 * A goal is a persistent user objective. After each turn, a judge model
 * evaluates whether the goal is satisfied. If not, a continuation prompt
 * is automatically fed back into the session until the goal is done,
 * the turn budget is exhausted, or the user sends a new message.
 *
 * Key design points:
 * - Continuation prompt is a normal user message (no system prompt mutation)
 * - Judge failures are fail-OPEN (continue) — turn budget is the backstop
 * - User messages preempt the goal loop (priority)
 * - State persists per-session via JSON file in ~/.skeleton/goals/
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const GOALS_DIR = path.join(os.homedir(), ".skeleton", "goals");

export const DEFAULT_MAX_TURNS = 20;
export const DEFAULT_MAX_PARSE_FAILURES = 3;

export const CONTINUATION_PROMPT_TEMPLATE = (
  "[Continuing toward your standing goal]\n" +
  "Goal: {goal}\n\n" +
  "Continue working toward this goal. Take the next concrete step. " +
  "If you believe the goal is complete, state so explicitly and stop. " +
  "If you are blocked and need input from the user, say so clearly and stop."
);

export type GoalStatus = "active" | "paused" | "done" | "cleared";

export type ChecklistItemStatus = "pending" | "completed" | "impossible";

export interface ChecklistItem {
  text: string;
  status: ChecklistItemStatus;
  addedBy: "agent" | "user";
  createdAt: number;
}

export interface GoalState {
  goal: string;
  status: GoalStatus;
  turnsUsed: number;
  maxTurns: number;
  createdAt: number;
  lastTurnAt: number;
  lastVerdict?: "done" | "continue" | "skipped";
  lastReason?: string;
  pausedReason?: string;
  consecutiveParseFailures: number;
  checklist: ChecklistItem[];
}

export function createGoal(goal: string, maxTurns: number = DEFAULT_MAX_TURNS): GoalState {
  return {
    goal,
    status: "active",
    turnsUsed: 0,
    maxTurns,
    createdAt: Date.now(),
    lastTurnAt: 0,
    consecutiveParseFailures: 0,
    checklist: [],
  };
}

export class GoalManager {
  private goals = new Map<string, GoalState>();

  constructor() {
    this.loadFromDisk();
  }

  /** Set or replace a goal for a session */
  setGoal(sessionId: string, goal: string, maxTurns: number = DEFAULT_MAX_TURNS): GoalState {
    const state = createGoal(goal, maxTurns);
    this.goals.set(sessionId, state);
    this.persist(sessionId, state);
    return state;
  }

  /** Get the current goal state for a session */
  getGoal(sessionId: string): GoalState | null {
    return this.goals.get(sessionId) ?? null;
  }

  /** Check if a session has an active goal */
  hasActiveGoal(sessionId: string): boolean {
    const state = this.goals.get(sessionId);
    return state !== undefined && state.status === "active";
  }

  /** Pause the goal loop (user-initiated) */
  pauseGoal(sessionId: string, reason: string = "user paused"): void {
    const state = this.goals.get(sessionId);
    if (!state) return;
    state.status = "paused";
    state.pausedReason = reason;
    this.persist(sessionId, state);
  }

  /** Resume a paused goal */
  resumeGoal(sessionId: string): boolean {
    const state = this.goals.get(sessionId);
    if (!state || state.status !== "paused") return false;
    state.status = "active";
    state.pausedReason = undefined;
    this.persist(sessionId, state);
    return true;
  }

  /** Mark goal as done */
  markDone(sessionId: string, reason: string = ""): void {
    const state = this.goals.get(sessionId);
    if (!state) return;
    state.status = "done";
    state.lastVerdict = "done";
    state.lastReason = reason;
    state.lastTurnAt = Date.now();
    this.persist(sessionId, state);
  }

  /** Clear the goal entirely */
  clearGoal(sessionId: string): void {
    this.goals.delete(sessionId);
    const filePath = this.filePath(sessionId);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }
  }

  /** Record a turn was used for this goal */
  incrementTurns(sessionId: string): void {
    const state = this.goals.get(sessionId);
    if (!state) return;
    state.turnsUsed++;
    state.lastTurnAt = Date.now();
    if (state.turnsUsed >= state.maxTurns) {
      state.status = "paused";
      state.pausedReason = `turn budget exhausted (${state.maxTurns})`;
    }
    this.persist(sessionId, state);
  }

  /** Update verdict after judge call */
  recordVerdict(sessionId: string, verdict: "done" | "continue" | "skipped", reason: string): void {
    const state = this.goals.get(sessionId);
    if (!state) return;
    state.lastVerdict = verdict;
    state.lastReason = reason;
    if (verdict === "done") {
      state.status = "done";
    }
    // Track parse failures for auto-pause
    if (reason.includes("not JSON") || reason.includes("empty response")) {
      state.consecutiveParseFailures++;
      if (state.consecutiveParseFailures >= DEFAULT_MAX_PARSE_FAILURES) {
        state.status = "paused";
        state.pausedReason = `judge parse failures (${state.consecutiveParseFailures})`;
      }
    } else {
      state.consecutiveParseFailures = 0;
    }
    this.persist(sessionId, state);
  }

  /** Build the continuation prompt for the next iteration */
  buildContinuationPrompt(sessionId: string): string | null {
    const state = this.goals.get(sessionId);
    if (!state || state.status !== "active") return null;
    return CONTINUATION_PROMPT_TEMPLATE.replace("{goal}", state.goal);
  }

  /** List all goals (for CLI display) */
  listGoals(): Array<{ sessionId: string; state: GoalState }> {
    return [...this.goals.entries()].map(([sessionId, state]) => ({ sessionId, state }));
  }

  // ── Subgoal (checklist) management — Hermes /subgoal pattern ────────

  /** Append a user-authored checklist item. Requires an active or paused goal. */
  addSubgoal(sessionId: string, text: string): ChecklistItem {
    const state = this.goals.get(sessionId);
    if (!state) throw new Error("no active goal");
    const trimmed = text.trim();
    if (!trimmed) throw new Error("subgoal text is empty");
    const item: ChecklistItem = {
      text: trimmed,
      status: "pending",
      addedBy: "user",
      createdAt: Date.now(),
    };
    if (!state.checklist) state.checklist = [];
    state.checklist.push(item);
    this.persist(sessionId, state);
    return item;
  }

  /** Override an item's status (1-based index). */
  markSubgoal(sessionId: string, index1Based: number, status: ChecklistItemStatus): ChecklistItem {
    const state = this.goals.get(sessionId);
    if (!state) throw new Error("no active goal");
    const checklist = state.checklist ?? [];
    const idx = index1Based - 1;
    if (idx < 0 || idx >= checklist.length) throw new RangeError(`index ${index1Based} out of range (1–${checklist.length})`);
    checklist[idx].status = status;
    this.persist(sessionId, state);
    return checklist[idx];
  }

  /** Remove a checklist item (1-based index). */
  removeSubgoal(sessionId: string, index1Based: number): ChecklistItem {
    const state = this.goals.get(sessionId);
    if (!state) throw new Error("no active goal");
    const checklist = state.checklist ?? [];
    const idx = index1Based - 1;
    if (idx < 0 || idx >= checklist.length) throw new RangeError(`index ${index1Based} out of range (1–${checklist.length})`);
    const [removed] = checklist.splice(idx, 1);
    this.persist(sessionId, state);
    return removed;
  }

  /** Wipe the checklist. */
  clearChecklist(sessionId: string): void {
    const state = this.goals.get(sessionId);
    if (!state) return;
    state.checklist = [];
    this.persist(sessionId, state);
  }

  /** Render checklist as a human-readable string. */
  renderChecklist(sessionId: string): string {
    const state = this.goals.get(sessionId);
    if (!state) return "(no active goal)";
    const checklist = state.checklist ?? [];
    if (checklist.length === 0) return "(no checklist items)";
    const statusIcon = (s: ChecklistItemStatus) =>
      s === "completed" ? "✅" : s === "impossible" ? "❌" : "⬜";
    return checklist.map((item, i) => `  ${i + 1}. ${statusIcon(item.status)} ${item.text}`).join("\n");
  }

  // ── Persistence ─────────────────────────────────────────────

  private filePath(sessionId: string): string {
    return path.join(GOALS_DIR, `${sessionId}.json`);
  }

  private persist(sessionId: string, state: GoalState): void {
    try {
      if (!fs.existsSync(GOALS_DIR)) {
        fs.mkdirSync(GOALS_DIR, { recursive: true });
      }
      fs.writeFileSync(this.filePath(sessionId), JSON.stringify(state, null, 2), "utf-8");
    } catch (err) {
      // Non-fatal: persistence failure shouldn't break the agent
      console.warn(`GoalManager: persist failed: ${(err as Error).message}`);
    }
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(GOALS_DIR)) return;
      for (const file of fs.readdirSync(GOALS_DIR)) {
        if (!file.endsWith(".json")) continue;
        const sessionId = file.slice(0, -5);
        try {
          const raw = fs.readFileSync(path.join(GOALS_DIR, file), "utf-8");
          const state = JSON.parse(raw) as GoalState;
          if (state.status === "done" || state.status === "cleared") {
            // Clean up completed goal files from disk
            try { fs.unlinkSync(path.join(GOALS_DIR, file)); } catch { /* ignore */ }
            continue;
          }
          this.goals.set(sessionId, state);
        } catch {
          // skip corrupted files
        }
      }
    } catch {
      // dir read failure — start empty
    }
  }
}
