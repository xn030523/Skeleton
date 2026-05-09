import type { ToolDef } from "../types.js";

interface TodoItem {
  task: string;
  status: "pending" | "done";
}

let todos: TodoItem[] = [];

export function todoTool(): ToolDef {
  return {
    name: "todo",
    description:
      "In-memory task list for decomposing complex tasks. " +
      "Call with 'todos' array to update/replace the list. " +
      "Call without 'todos' to read the current list. " +
      "Re-injected after context compression so the agent remembers pending work.",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              task: { type: "string", description: "Task description" },
              status: { type: "string", enum: ["pending", "done"], description: "Task status" },
            },
            required: ["task", "status"],
          },
          description: "Full task list to write. Omit to read the current list.",
        },
      },
    },
    execute: async (args) => {
      const { todos: newTodos } = args as { todos?: TodoItem[] };

      if (newTodos === undefined || newTodos === null) {
        if (todos.length === 0) {
          return { message: "No tasks in the todo list.", todos: [] };
        }

        const pending = todos.filter((t) => t.status === "pending");
        const done = todos.filter((t) => t.status === "done");

        const lines: string[] = [];
        if (pending.length > 0) {
          lines.push(`Pending (${pending.length}):`);
          for (const t of pending) lines.push(`  [ ] ${t.task}`);
        }
        if (done.length > 0) {
          lines.push(`Done (${done.length}):`);
          for (const t of done) lines.push(`  [x] ${t.task}`);
        }

        return {
          message: lines.join("\n"),
          todos,
          pending_count: pending.length,
          done_count: done.length,
        };
      }

      todos = newTodos.map((t: TodoItem) => ({
        task: String(t.task ?? ""),
        status: t.status === "done" ? "done" : "pending",
      }));

      const pending = todos.filter((t) => t.status === "pending");
      const done = todos.filter((t) => t.status === "done");

      return {
        message: `Updated todo list: ${pending.length} pending, ${done.length} done.`,
        todos,
        pending_count: pending.length,
        done_count: done.length,
      };
    },
    toolset: "planning",
  };
}

export function getTodos(): TodoItem[] {
  return [...todos];
}

export function resetTodos(): void {
  todos = [];
}
