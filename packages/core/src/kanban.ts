/**
 * Kanban multi-agent coordination — task board for
 * managing work across multiple agents.
 *
 * Operations: show, create, complete, block, heartbeat, comment
 * Inspired by Hermes kanban_tools.py.
 */

import type { ToolDef } from "./types.js";

export interface KanbanCard {
  id: string;
  title: string;
  description: string;
  status: "todo" | "in_progress" | "blocked" | "done";
  assignee: string;
  blockedBy: string[];
  comments: Array<{ author: string; text: string; timestamp: number }>;
  createdAt: number;
  updatedAt: number;
}

let nextCardId = 1;

export class KanbanBoard {
  private cards = new Map<string, KanbanCard>();

  create(title: string, description: string, assignee: string = "unassigned"): KanbanCard {
    const card: KanbanCard = {
      id: `card_${nextCardId++}`,
      title,
      description,
      status: "todo",
      assignee,
      blockedBy: [],
      comments: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.cards.set(card.id, card);
    return card;
  }

  get(id: string): KanbanCard | null {
    return this.cards.get(id) ?? null;
  }

  list(status?: KanbanCard["status"]): KanbanCard[] {
    const all = [...this.cards.values()];
    return status ? all.filter(c => c.status === status) : all;
  }

  complete(id: string): boolean {
    const card = this.cards.get(id);
    if (!card) return false;
    card.status = "done";
    card.updatedAt = Date.now();
    return true;
  }

  block(id: string, blockedBy: string): boolean {
    const card = this.cards.get(id);
    if (!card) return false;
    card.status = "blocked";
    if (!card.blockedBy.includes(blockedBy)) card.blockedBy.push(blockedBy);
    card.updatedAt = Date.now();
    return true;
  }

  heartbeat(id: string, note: string): boolean {
    const card = this.cards.get(id);
    if (!card) return false;
    card.status = "in_progress";
    card.updatedAt = Date.now();
    if (note) {
      card.comments.push({ author: "heartbeat", text: note, timestamp: Date.now() });
    }
    return true;
  }

  comment(id: string, author: string, text: string): boolean {
    const card = this.cards.get(id);
    if (!card) return false;
    card.comments.push({ author, text, timestamp: Date.now() });
    card.updatedAt = Date.now();
    return true;
  }
}

/** Build Kanban tool for LLM */
export function kanbanTool(board: KanbanBoard): ToolDef {
  return {
    name: "kanban",
    description: "Manage a Kanban task board for multi-agent coordination. Create tasks, mark complete, block/unblock, add heartbeat updates, and comment.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["show", "create", "complete", "block", "heartbeat", "comment"],
          description: "Action to perform",
        },
        id: { type: "string", description: "Card ID (for complete/block/heartbeat/comment)" },
        title: { type: "string", description: "Card title (for create)" },
        description: { type: "string", description: "Card description (for create)" },
        assignee: { type: "string", description: "Assignee name (for create)" },
        blocked_by: { type: "string", description: "ID of blocking card (for block)" },
        note: { type: "string", description: "Heartbeat note or comment text" },
        author: { type: "string", description: "Comment author (for comment)" },
        status: { type: "string", enum: ["todo", "in_progress", "blocked", "done"], description: "Filter by status (for show)" },
      },
      required: ["action"],
    },
    execute: async (args) => {
      const action = String(args.action ?? "");

      switch (action) {
        case "show": {
          const cards = board.list(args.status as KanbanCard["status"] | undefined);
          if (cards.length === 0) return "Board is empty.";
          return cards.map(c =>
            `[${c.status.toUpperCase()}] ${c.id}: ${c.title}\n  Assignee: ${c.assignee}\n  ${c.blockedBy.length ? `Blocked by: ${c.blockedBy.join(", ")}\n  ` : ""}${c.comments.length ? `Comments: ${c.comments.length}` : ""}`,
          ).join("\n\n");
        }
        case "create": {
          if (!args.title) return "Error: title required for create";
          const card = board.create(String(args.title), String(args.description ?? ""), String(args.assignee ?? "unassigned"));
          return `Created card ${card.id}: ${card.title}`;
        }
        case "complete": {
          if (!args.id) return "Error: id required for complete";
          const ok = board.complete(String(args.id));
          return ok ? `Card ${args.id} marked done` : `Card ${args.id} not found`;
        }
        case "block": {
          if (!args.id || !args.blocked_by) return "Error: id and blocked_by required";
          const ok = board.block(String(args.id), String(args.blocked_by));
          return ok ? `Card ${args.id} blocked by ${args.blocked_by}` : `Card ${args.id} not found`;
        }
        case "heartbeat": {
          if (!args.id) return "Error: id required for heartbeat";
          const ok = board.heartbeat(String(args.id), String(args.note ?? ""));
          return ok ? `Heartbeat updated for card ${args.id}` : `Card ${args.id} not found`;
        }
        case "comment": {
          if (!args.id) return "Error: id required for comment";
          const ok = board.comment(String(args.id), String(args.author ?? "agent"), String(args.note ?? ""));
          return ok ? `Comment added to card ${args.id}` : `Card ${args.id} not found`;
        }
        default:
          return `Error: unknown action "${action}"`;
      }
    },
    toolset: "system",
    emoji: "📋",
  };
}
