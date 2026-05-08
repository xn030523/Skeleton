import type { ToolDef } from "../types.js";
import type { WorkingMemory } from "./working.js";

export function workingMemoryTools(wm: WorkingMemory): ToolDef[] {
  return [setTaskTool(wm), updateStepTool(wm), setResultTool(wm), addNoteTool(wm)];
}

function setTaskTool(wm: WorkingMemory): ToolDef {
  return {
    name: "set_task",
    description:
      "Set the current task with steps. Use to track multi-step RE workflows " +
      "(e.g., 'Analyze binary' with steps: identify → strings → disassemble → report).",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Task identifier (kebab-case)." },
        description: { type: "string", description: "Task description." },
        steps: {
          type: "array",
          items: { type: "string" },
          description: "Ordered list of step names.",
        },
      },
      required: ["id", "description", "steps"],
    },
    execute: async (args) => {
      const id = String(args.id);
      const description = String(args.description);
      const steps = args.steps as string[] ?? [];
      const task = wm.setTask(id, description, steps);
      return `Task set: "${task.description}" with ${task.steps.length} steps.`;
    },
  };
}

function updateStepTool(wm: WorkingMemory): ToolDef {
  return {
    name: "update_step",
    description: "Update a task step status (pending/in_progress/done/skipped) and optionally record a result.",
    parameters: {
      type: "object",
      properties: {
        step_name: { type: "string", description: "Step name to update." },
        status: { type: "string", enum: ["pending", "in_progress", "done", "skipped"], description: "New status." },
        result: { type: "string", description: "Optional result for this step." },
      },
      required: ["step_name", "status"],
    },
    execute: async (args) => {
      const ok = wm.updateStep(
        String(args.step_name),
        String(args.status) as "pending" | "in_progress" | "done" | "skipped",
        args.result ? String(args.result) : undefined,
      );
      return ok ? `Step '${args.step_name}' → ${args.status}` : "Error: no current task or step not found";
    },
  };
}

function setResultTool(wm: WorkingMemory): ToolDef {
  return {
    name: "set_intermediate_result",
    description: "Store an intermediate result for the current task (e.g., offset found, key extracted).",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "Result key name." },
        value: { type: "string", description: "Result value." },
      },
      required: ["key", "value"],
    },
    execute: async (args) => {
      wm.setResult(String(args.key), String(args.value));
      return `Intermediate result stored: ${args.key}`;
    },
  };
}

function addNoteTool(wm: WorkingMemory): ToolDef {
  return {
    name: "add_working_note",
    description: "Add a working note to track observations, hypotheses, or reminders during the task.",
    parameters: {
      type: "object",
      properties: {
        note: { type: "string", description: "Working note content." },
      },
      required: ["note"],
    },
    execute: async (args) => {
      wm.addNote(String(args.note));
      return "Note added.";
    },
  };
}
