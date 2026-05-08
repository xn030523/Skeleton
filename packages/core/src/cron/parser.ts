import type { CronJob, ScheduleFormat } from "./store.js";

/** Check if a job should fire at the current time */
export function shouldFire(job: CronJob, now: Date = new Date()): boolean {
  if (!job.enabled) return false;
  if (!job.nextRun) return false;

  const next = new Date(job.nextRun);
  if (now < next) return false;

  // At-most-once: if lastRun >= nextRun, skip
  if (job.lastRun && new Date(job.lastRun) >= next) return false;

  return true;
}

/** Recompute nextRun after a job fires */
export function reschedule(job: CronJob): ScheduleFormat | null {
  switch (job.schedule.type) {
    case "duration":
    case "timestamp":
      // One-shot: disable after fire
      return null;
    case "interval":
      return { type: "interval", seconds: job.schedule.seconds };
    case "cron":
      return { type: "cron", expression: job.schedule.expression };
  }
}

/** Parse a cron expression (5-field) into minute/hour/dom/month/dow components */
export function parseCronExpression(expr: string): {
  minute: number[];
  hour: number[];
  dom: number[];
  month: number[];
  dow: number[];
} | null {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return null;

  return {
    minute: parseField(fields[0], 0, 59),
    hour: parseField(fields[1], 0, 23),
    dom: parseField(fields[2], 1, 31),
    month: parseField(fields[3], 1, 12),
    dow: parseField(fields[4], 0, 6),
  };
}

/** Compute next fire time for a cron expression from a given date */
export function nextCronDate(expr: string, from: Date = new Date()): Date | null {
  const parsed = parseCronExpression(expr);
  if (!parsed) return null;

  // Start from next minute
  const next = new Date(from.getTime() + 60_000);
  next.setSeconds(0, 0);

  // Search up to 1 year ahead
  const limit = new Date(from.getTime() + 365 * 24 * 60 * 60_000);
  while (next <= limit) {
    if (
      parsed.minute.includes(next.getMinutes()) &&
      parsed.hour.includes(next.getHours()) &&
      parsed.dom.includes(next.getDate()) &&
      parsed.month.includes(next.getMonth() + 1) &&
      parsed.dow.includes(next.getDay())
    ) {
      return next;
    }
    next.setMinutes(next.getMinutes() + 1);
  }

  return null;
}

function parseField(field: string, min: number, max: number): number[] {
  if (field === "*") return range(min, max);

  const values: number[] = [];
  for (const part of field.split(",")) {
    if (part.includes("/")) {
      const [rangeStr, stepStr] = part.split("/");
      const step = parseInt(stepStr, 10);
      const [start, end] = rangeStr === "*"
        ? [min, max]
        : rangeStr.split("-").map(Number);
      for (let i = start; i <= (end ?? max); i += step) {
        values.push(i);
      }
    } else if (part.includes("-")) {
      const [start, end] = part.split("-").map(Number);
      for (let i = start; i <= end; i++) values.push(i);
    } else {
      values.push(parseInt(part, 10));
    }
  }

  return values.filter((v) => v >= min && v <= max);
}

function range(min: number, max: number): number[] {
  const arr: number[] = [];
  for (let i = min; i <= max; i++) arr.push(i);
  return arr;
}
