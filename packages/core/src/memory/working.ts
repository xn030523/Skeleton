/**
 * Working memory — tracks in-progress task state within a session.
 * Hermes pattern: task progress is stored here, not in long-term memory.
 * Cleared on session reset; not persisted between sessions.
 */
export interface WorkingTask {
  id: string;
  description: string;
  status: "pending" | "in_progress" | "blocked" | "completed";
  steps: WorkingStep[];
  intermediateResults: Map<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface WorkingStep {
  name: string;
  status: "pending" | "in_progress" | "done" | "skipped";
  result?: string;
}

export class WorkingMemory {
  private tasks = new Map<string, WorkingTask>();
  private currentTaskId: string | null = null;
  private notes: string[] = [];

  /** Set the current task */
  setTask(id: string, description: string, steps: string[]): WorkingTask {
    const task: WorkingTask = {
      id,
      description,
      status: "in_progress",
      steps: steps.map((name) => ({ name, status: "pending" as const })),
      intermediateResults: new Map(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.tasks.set(id, task);
    this.currentTaskId = id;
    return task;
  }

  /** Get the current task */
  getCurrentTask(): WorkingTask | null {
    if (!this.currentTaskId) return null;
    return this.tasks.get(this.currentTaskId) ?? null;
  }

  /** Update a step status */
  updateStep(stepName: string, status: WorkingStep["status"], result?: string): boolean {
    const task = this.getCurrentTask();
    if (!task) return false;
    const step = task.steps.find((s) => s.name === stepName);
    if (!step) return false;
    step.status = status;
    if (result !== undefined) step.result = result;
    task.updatedAt = new Date().toISOString();

    // Auto-update task status
    if (task.steps.every((s) => s.status === "done" || s.status === "skipped")) {
      task.status = "completed";
    }
    return true;
  }

  /** Store an intermediate result */
  setResult(key: string, value: string): void {
    const task = this.getCurrentTask();
    if (!task) return;
    task.intermediateResults.set(key, value);
    task.updatedAt = new Date().toISOString();
  }

  /** Get an intermediate result */
  getResult(key: string): string | undefined {
    return this.getCurrentTask()?.intermediateResults.get(key);
  }

  /** Add a working note */
  addNote(note: string): void {
    this.notes.push(note);
  }

  /** Build context string for system prompt */
  buildContext(): string {
    const parts: string[] = [];
    const task = this.getCurrentTask();

    if (task) {
      const stepsStr = task.steps
        .map((s) => `  - [${s.status}] ${s.name}${s.result ? `: ${s.result.slice(0, 100)}` : ""}`)
        .join("\n");
      parts.push(`### Current Task: ${task.description} [${task.status}]`);
      parts.push(`Steps:\n${stepsStr}`);

      if (task.intermediateResults.size > 0) {
        parts.push("Intermediate Results:");
        for (const [k, v] of task.intermediateResults) {
          parts.push(`  - ${k}: ${v.slice(0, 150)}`);
        }
      }
    }

    if (this.notes.length > 0) {
      parts.push(`### Working Notes\n${this.notes.map((n) => `- ${n}`).join("\n")}`);
    }

    return parts.length > 0
      ? `## Working Memory\n${parts.join("\n")}`
      : "";
  }

  /** Clear working memory */
  clear(): void {
    this.tasks.clear();
    this.currentTaskId = null;
    this.notes = [];
  }
}
