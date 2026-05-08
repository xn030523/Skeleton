import type { ToolDef } from "../types.js";
import type { SessionDB } from "./index.js";

export function sessionSearchTool(sessionDb: SessionDB): ToolDef {
  return {
    name: "session_search",
    description:
      "Search past conversation sessions for relevant context. " +
      "Use this to find how you previously solved similar problems, " +
      "recall past findings, or trace the history of a topic across sessions. " +
      "Supports Latin and CJK (Chinese/Japanese/Korean) text search.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query — keywords or phrases from past conversations.",
        },
        limit: {
          type: "number",
          description: "Max results (default 20).",
        },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const query = String(args.query ?? "");
      const limit = Number(args.limit ?? 20);

      if (!query.trim()) return "Error: empty query";

      const results = sessionDb.search(query, limit);

      if (results.length === 0) {
        return `No past sessions found for "${query}".`;
      }

      return results
        .map((r) => `[${r.role}, ${r.createdAt.slice(0, 10)}] ${r.content.slice(0, 300)}`)
        .join("\n\n");
    },
  };
}

export function recentSessionsTool(sessionDb: SessionDB): ToolDef {
  return {
    name: "recent_sessions",
    description:
      "List recent conversation sessions with summaries. " +
      "Use to review what you've been working on recently.",
    parameters: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max sessions to return (default 10).",
        },
      },
    },
    execute: async (args) => {
      const limit = Number(args.limit ?? 10);
      const sessions = sessionDb.recentSessions(limit);

      if (sessions.length === 0) return "No past sessions found.";

      return sessions
        .map((s) => `[${s.id.slice(0, 8)}] ${s.title ?? "Untitled"} (${s.messageCount} messages, ${s.createdAt.slice(0, 10)})`)
        .join("\n");
    },
  };
}
