import type { ToolDef } from "../types.js";

export function clarifyTool(): ToolDef {
  return {
    name: "clarify",
    description:
      "Ask a clarifying question with structured multiple-choice options. " +
      "Max 4 predefined choices with 'Other' always appended. " +
      "Use when the task is ambiguous and you need the user to pick a direction.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The clarifying question to ask",
        },
        options: {
          type: "array",
          items: { type: "string" },
          maxItems: 4,
          description: "Up to 4 predefined answer choices. 'Other' is always appended automatically.",
        },
      },
      required: ["question"],
    },
    execute: async (args) => {
      const { question, options = [] } = args as {
        question: string;
        options?: string[];
      };

      if (!question?.trim()) return { error: "Question cannot be empty" };

      const limited = options.slice(0, 4);
      const choices = [...limited, "Other"];

      const lines: string[] = [
        question,
        "",
      ];

      for (let i = 0; i < choices.length; i++) {
        lines.push(`${i + 1}. ${choices[i]}`);
      }

      lines.push("");
      lines.push("Reply with the number of your choice, or type your own answer.");

      const formatted = lines.join("\n");

      return {
        question,
        choices,
        formatted,
      };
    },
    toolset: "interaction",
  };
}
