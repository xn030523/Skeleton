import type { ToolDef } from "../types.js";
import type { CronStore, CronJob, ScheduleFormat } from "./store.js";

/** cron_manage tool — lets the LLM create and manage scheduled tasks */
export function cronManageTool(store: CronStore): ToolDef {
  return {
    name: "cron_manage",
    description:
      "Manage scheduled/cron tasks. Actions: " +
      "'create' — create a new scheduled task; " +
      "'list' — list all tasks; " +
      "'update' — modify a task; " +
      "'delete' — remove a task; " +
      "'enable'/'disable' — toggle a task. " +
      "Schedule types: cron (5-field expression), interval (every N seconds), " +
      "duration (once after N seconds), timestamp (once at ISO date).",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "list", "update", "delete", "enable", "disable"],
          description: "Action to perform.",
        },
        id: {
          type: "string",
          description: "Job ID (for update/delete/enable/disable).",
        },
        name: {
          type: "string",
          description: "Human-readable job name (for create/update).",
        },
        schedule_type: {
          type: "string",
          enum: ["cron", "interval", "duration", "timestamp"],
          description: "Schedule type (for create/update).",
        },
        cron_expression: {
          type: "string",
          description: "5-field cron expression (when schedule_type=cron). E.g. '0 9 * * 1-5' = weekdays 9am.",
        },
        interval_seconds: {
          type: "number",
          description: "Interval in seconds (when schedule_type=interval).",
        },
        duration_seconds: {
          type: "number",
          description: "Delay in seconds for one-shot (when schedule_type=duration).",
        },
        timestamp_date: {
          type: "string",
          description: "ISO date string for one-shot (when schedule_type=timestamp).",
        },
        prompt: {
          type: "string",
          description: "Prompt to execute when the job fires (for create/update).",
        },
        delivery: {
          type: "array",
          items: { type: "string", enum: ["cli", "telegram", "webhook"] },
          description: "Delivery targets (default: ['cli']).",
        },
        webhook_url: {
          type: "string",
          description: "Webhook URL if delivery includes 'webhook'.",
        },
      },
      required: ["action"],
    },
    execute: async (args) => {
      const action = String(args.action);

      switch (action) {
        case "list": {
          const jobs = store.list();
          if (jobs.length === 0) return "No scheduled tasks.";
          return jobs
            .map((j) => {
              const status = j.enabled ? "enabled" : "disabled";
              const next = j.nextRun ? `next: ${j.nextRun}` : "no upcoming run";
              return `[${j.id}] ${j.name} (${status}, runs: ${j.runCount}, ${next}) — ${describeSchedule(j.schedule)}`;
            })
            .join("\n");
        }

        case "create": {
          const schedule = buildSchedule(args);
          if (!schedule) return "Error: invalid schedule. Provide schedule_type + corresponding field.";

          const name = String(args.name ?? "Unnamed task");
          const prompt = String(args.prompt ?? "");
          if (!prompt) return "Error: prompt is required";

          const delivery = (args.delivery as string[]) ?? ["cli"];
          const webhookUrl = args.webhook_url ? String(args.webhook_url) : undefined;

          const job = store.add({
            name,
            schedule,
            prompt,
            enabled: true,
            delivery: delivery as ("cli" | "telegram" | "webhook")[],
            webhookUrl,
          });

          return `Task '${name}' created (id=${job.id}, ${describeSchedule(schedule)}). Next run: ${job.nextRun ?? "N/A"}`;
        }

        case "update": {
          const id = String(args.id ?? "");
          if (!id) return "Error: id is required";
          const schedule = args.schedule_type ? buildSchedule(args) : undefined;
          const patch: Record<string, unknown> = {};
          if (args.name) patch.name = String(args.name);
          if (args.prompt) patch.prompt = String(args.prompt);
          if (args.delivery) patch.delivery = args.delivery;
          if (args.webhook_url) patch.webhookUrl = String(args.webhook_url);
          if (schedule) patch.schedule = schedule;

          const updated = store.update(id, patch);
          if (!updated) return `Error: task '${id}' not found`;
          return `Task '${updated.name}' updated.`;
        }

        case "delete": {
          const id = String(args.id ?? "");
          if (!id) return "Error: id is required";
          const removed = store.remove(id);
          return removed ? `Task ${id} deleted.` : `Error: task '${id}' not found`;
        }

        case "enable": {
          const id = String(args.id ?? "");
          if (!id) return "Error: id is required";
          const updated = store.update(id, { enabled: true });
          return updated ? `Task '${updated.name}' enabled.` : `Error: task '${id}' not found`;
        }

        case "disable": {
          const id = String(args.id ?? "");
          if (!id) return "Error: id is required";
          const updated = store.update(id, { enabled: false });
          return updated ? `Task '${updated.name}' disabled.` : `Error: task '${id}' not found`;
        }

        default:
          return `Error: unknown action '${action}'`;
      }
    },
  };
}

function buildSchedule(args: Record<string, unknown>): ScheduleFormat | null {
  const type = String(args.schedule_type ?? "");
  switch (type) {
    case "cron":
      if (!args.cron_expression) return null;
      return { type: "cron", expression: String(args.cron_expression) };
    case "interval":
      if (!args.interval_seconds) return null;
      return { type: "interval", seconds: Number(args.interval_seconds) };
    case "duration":
      if (!args.duration_seconds) return null;
      return { type: "duration", seconds: Number(args.duration_seconds) };
    case "timestamp":
      if (!args.timestamp_date) return null;
      return { type: "timestamp", date: String(args.timestamp_date) };
    default:
      return null;
  }
}

function describeSchedule(schedule: ScheduleFormat): string {
  switch (schedule.type) {
    case "cron": return `cron: ${schedule.expression}`;
    case "interval": return `every ${schedule.seconds}s`;
    case "duration": return `once after ${schedule.seconds}s`;
    case "timestamp": return `at ${schedule.date}`;
  }
}
