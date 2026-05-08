import type { ToolDef } from "../types.js";
import type { MemoryStore, MemoryCategory } from "./store.js";
import type { UserProfile } from "./user-profile.js";

export function memoryTools(
  memory: MemoryStore,
  userProfile: UserProfile,
): ToolDef[] {
  return [
    saveMemoryTool(memory, userProfile),
    searchMemoryTool(memory),
    getUserProfileTool(userProfile),
    consolidateMemoriesTool(memory),
  ];
}

function saveMemoryTool(memory: MemoryStore, userProfile: UserProfile): ToolDef {
  return {
    name: "save_memory",
    description:
      "Save a fact, preference, technique, or observation to persistent memory. " +
      "Saved memories persist across sessions and are loaded into future conversations. " +
      "Use category 'preference' for user preferences, 'technique' for RE methods, " +
      "'finding' for discoveries, 'project' for project context, 'environment' for tool/env info.",
    parameters: {
      type: "object",
      properties: {
        content: {
          type: "string",
          description: "The memory content to save. Be specific and self-contained.",
        },
        category: {
          type: "string",
          enum: ["general", "finding", "technique", "preference", "project", "environment", "tool_result", "lesson"],
          description: "Category of the memory. Default: 'general'.",
        },
        is_user_preference: {
          type: "boolean",
          description: "If true, also save to global user profile (cross-project). Use for user preferences about workflow, output style, etc.",
        },
      },
      required: ["content"],
    },
    execute: async (args) => {
      const content = String(args.content ?? "");
      const category = String(args.category ?? "general") as MemoryCategory;
      const isUserPref = Boolean(args.is_user_preference);

      if (!content.trim()) return "Error: empty content";

      const id = memory.add(content, category, "manual");
      const lines: string[] = [];

      if (id > 0) {
        lines.push(`Memory saved (id=${id}, category=${category}).`);
      } else {
        lines.push("Similar memory already exists, skipped.");
      }

      if (isUserPref) {
        userProfile.addPreference(content);
        lines.push("Also added to global user profile.");
      }

      return lines.join(" ");
    },
  };
}

function searchMemoryTool(memory: MemoryStore): ToolDef {
  return {
    name: "search_memory",
    description:
      "Search persistent memory for past facts, techniques, or findings. " +
      "Use this before attempting tasks to leverage knowledge from past sessions.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query — keywords or phrases to find in memories.",
        },
        category: {
          type: "string",
          description: "Optional category filter (general, finding, technique, preference, project, environment, tool_result, lesson).",
        },
        limit: {
          type: "number",
          description: "Max results (default 10).",
        },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const query = String(args.query ?? "");
      const category = args.category as string | undefined;
      const limit = Number(args.limit ?? 10);

      if (!query.trim()) return "Error: empty query";

      // If category specified, do filtered search
      let results = memory.search(query, limit);
      if (category) {
        results = results.filter((r) => r.category === category);
      }

      if (results.length === 0) {
        return `No memories found for "${query}".`;
      }

      return results
        .map((r) => `[${r.category}] (id=${r.id}, used ${r.useCount}x) ${r.content}`)
        .join("\n");
    },
  };
}

function getUserProfileTool(userProfile: UserProfile): ToolDef {
  return {
    name: "get_user_profile",
    description:
      "Read the global user profile — preferences, projects, environment notes. " +
      "These persist across all sessions and projects.",
    parameters: {
      type: "object",
      properties: {},
    },
    execute: async () => {
      const data = userProfile.getLive();
      const parts: string[] = [];

      if (data.preferences.length > 0) {
        parts.push("Preferences:", ...data.preferences.map((p) => `  - ${p}`));
      }
      if (data.projects.length > 0) {
        parts.push("Projects:", ...data.projects.map((p) => `  - ${p}`));
      }
      if (data.environment.length > 0) {
        parts.push("Environment:", ...data.environment.map((e) => `  - ${e}`));
      }
      if (data.notes.length > 0) {
        parts.push("Notes:", ...data.notes.map((n) => `  - ${n}`));
      }

      return parts.length > 0 ? parts.join("\n") : "User profile is empty.";
    },
  };
}

function consolidateMemoriesTool(memory: MemoryStore): ToolDef {
  return {
    name: "consolidate_memories",
    description:
      "Consolidate (merge) related memory fragments into coherent entries. " +
      "Run periodically or when you notice fragmented/duplicate memories. " +
      "Optionally filter by category.",
    parameters: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description: "Optional category to consolidate. If omitted, consolidates all categories.",
        },
      },
    },
    execute: async (args) => {
      const category = args.category as string | undefined;
      const count = memory.consolidate(category);
      return count > 0
        ? `Consolidated ${count} groups of related memories.`
        : "No memories needed consolidation.";
    },
  };
}
