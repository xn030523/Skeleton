/**
 * Kanban multi-agent coordination — durable task board for
 * managing work across multiple agents.
 *
 * v2: heartbeat + reclaim + zombie detection + per-task retries +
 * hallucination gate + auto-block on incomplete exit.
 *
 * Operations: show, create, assign, complete, block, unblock, heartbeat,
 * comment, reclaim, retry
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ToolDef } from "./types.js";

export interface KanbanCard {
  id: string;
  title: string;
  description: string;
  status: "todo" | "in_progress" | "blocked" | "done" | "failed";
  assignee: string;
  blockedBy: string[];
  comments: Array<{ author: string; text: string; timestamp: number }>;
  createdAt: number;
  updatedAt: number;
  lastHeartbeat: number;
  retryCount: number;
  maxRetries: number;
  completionEvidence?: string;
}

const KANBAN_DIR = path.join(os.homedir(), ".skeleton", "kanban");
const HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes without heartbeat = zombie
const DEFAULT_MAX_RETRIES = 3;

let nextCardId = 1;

export class KanbanBoard {
  private cards = new Map<string, KanbanCard>();
  private boardFile: string;

  constructor(boardName = "default") {
    this.boardFile = path.join(KANBAN_DIR, `${boardName}.json`);
    this.loadFromDisk();
  }

  create(title: string, description: string, assignee = "unassigned", maxRetries = DEFAULT_MAX_RETRIES): KanbanCard {
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
      lastHeartbeat: 0,
      retryCount: 0,
      maxRetries,
    };
    this.cards.set(card.id, card);
    this.saveToDisk();
    return card;
  }

  get(id: string): KanbanCard | null {
    return this.cards.get(id) ?? null;
  }

  list(status?: KanbanCard["status"]): KanbanCard[] {
    const all = [...this.cards.values()];
    return status ? all.filter(c => c.status === status) : all;
  }

  assign(id: string, assignee: string): boolean {
    const card = this.cards.get(id);
    if (!card) return false;
    card.assignee = assignee;
    card.status = "in_progress";
    card.lastHeartbeat = Date.now();
    card.updatedAt = Date.now();
    this.saveToDisk();
    return true;
  }

  complete(id: string, evidence?: string): boolean {
    const card = this.cards.get(id);
    if (!card) return false;

    // Hallucination gate: require evidence for completion
    if (!evidence && card.status === "in_progress") {
      card.comments.push({
        author: "system",
        text: "Completion attempted without evidence — provide proof of completion.",
        timestamp: Date.now(),
      });
      this.saveToDisk();
      return false;
    }

    card.status = "done";
    card.completionEvidence = evidence;
    card.updatedAt = Date.now();
    this.saveToDisk();
    return true;
  }

  block(id: string, blockedBy: string, reason?: string): boolean {
    const card = this.cards.get(id);
    if (!card) return false;
    card.status = "blocked";
    if (!card.blockedBy.includes(blockedBy)) card.blockedBy.push(blockedBy);
    if (reason) card.comments.push({ author: "system", text: `Blocked: ${reason}`, timestamp: Date.now() });
    card.updatedAt = Date.now();
    this.saveToDisk();
    return true;
  }

  unblock(id: string, unblockedBy: string): boolean {
    const card = this.cards.get(id);
    if (!card) return false;
    card.blockedBy = card.blockedBy.filter(b => b !== unblockedBy);
    if (card.blockedBy.length === 0 && card.status === "blocked") {
      card.status = "todo";
    }
    card.updatedAt = Date.now();
    this.saveToDisk();
    return true;
  }

  heartbeat(id: string, note?: string): boolean {
    const card = this.cards.get(id);
    if (!card) return false;
    card.lastHeartbeat = Date.now();
    card.updatedAt = Date.now();
    if (card.status !== "in_progress") card.status = "in_progress";
    if (note) card.comments.push({ author: "heartbeat", text: note, timestamp: Date.now() });
    this.saveToDisk();
    return true;
  }

  comment(id: string, author: string, text: string): boolean {
    const card = this.cards.get(id);
    if (!card) return false;
    card.comments.push({ author, text, timestamp: Date.now() });
    card.updatedAt = Date.now();
    this.saveToDisk();
    return true;
  }

  /** Detect zombie tasks (in_progress but no heartbeat for HEARTBEAT_TIMEOUT_MS) */
  detectZombies(): KanbanCard[] {
    const now = Date.now();
    const zombies: KanbanCard[] = [];
    for (const card of this.cards.values()) {
      if (card.status === "in_progress" && card.lastHeartbeat > 0) {
        if (now - card.lastHeartbeat > HEARTBEAT_TIMEOUT_MS) {
          zombies.push(card);
        }
      }
    }
    return zombies;
  }

  /** Reclaim zombie tasks — mark as failed and optionally retry */
  reclaimZombies(): Array<{ card: KanbanCard; action: "retried" | "failed" }> {
    const zombies = this.detectZombies();
    const results: Array<{ card: KanbanCard; action: "retried" | "failed" }> = [];

    for (const card of zombies) {
      card.retryCount++;
      if (card.retryCount <= card.maxRetries) {
        card.status = "todo";
        card.assignee = "unassigned";
        card.lastHeartbeat = 0;
        card.comments.push({
          author: "system",
          text: `Zombie detected — reclaimed for retry (${card.retryCount}/${card.maxRetries})`,
          timestamp: Date.now(),
        });
        results.push({ card, action: "retried" });
      } else {
        card.status = "failed";
        card.comments.push({
          author: "system",
          text: `Zombie detected — max retries (${card.maxRetries}) exhausted, marking failed`,
          timestamp: Date.now(),
        });
        results.push({ card, action: "failed" });
      }
      card.updatedAt = Date.now();
    }

    if (results.length > 0) this.saveToDisk();
    return results;
  }

  /** Auto-block: mark in_progress tasks as failed when worker exits without completing */
  markAbandonedByWorker(assignee: string): number {
    let count = 0;
    for (const card of this.cards.values()) {
      if (card.assignee === assignee && card.status === "in_progress") {
        card.retryCount++;
        if (card.retryCount <= card.maxRetries) {
          card.status = "todo";
          card.assignee = "unassigned";
          card.lastHeartbeat = 0;
          card.comments.push({
            author: "system",
            text: `Worker "${assignee}" exited without completing — reclaimed (${card.retryCount}/${card.maxRetries})`,
            timestamp: Date.now(),
          });
        } else {
          card.status = "failed";
          card.comments.push({
            author: "system",
            text: `Worker "${assignee}" exited — max retries exhausted`,
            timestamp: Date.now(),
          });
        }
        card.updatedAt = Date.now();
        count++;
      }
    }
    if (count > 0) this.saveToDisk();
    return count;
  }

  private loadFromDisk(): void {
    try {
      if (!fs.existsSync(this.boardFile)) return;
      const raw = JSON.parse(fs.readFileSync(this.boardFile, "utf-8")) as KanbanCard[];
      for (const card of raw) {
        this.cards.set(card.id, card);
        const numId = parseInt(card.id.replace("card_", ""), 10);
        if (numId >= nextCardId) nextCardId = numId + 1;
      }
    } catch { /* start empty */ }
  }

  private saveToDisk(): void {
    try {
      fs.mkdirSync(KANBAN_DIR, { recursive: true });
      const data = [...this.cards.values()];
      fs.writeFileSync(this.boardFile, JSON.stringify(data, null, 2), "utf-8");
    } catch { /* non-critical */ }
  }
}

export function kanbanTool(board: KanbanBoard): ToolDef {
  return {
    name: "kanban",
    description: "Durable Kanban task board for multi-agent coordination. Create tasks, assign, complete (with evidence), block/unblock, heartbeat, detect zombies, reclaim stale tasks.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["show", "create", "assign", "complete", "block", "unblock", "heartbeat", "comment", "zombies", "reclaim"],
          description: "Action to perform",
        },
        id: { type: "string", description: "Card ID" },
        title: { type: "string", description: "Card title (for create)" },
        description: { type: "string", description: "Card description (for create)" },
        assignee: { type: "string", description: "Assignee name" },
        blocked_by: { type: "string", description: "ID of blocking card (for block)" },
        reason: { type: "string", description: "Block reason" },
        note: { type: "string", description: "Heartbeat note or comment text" },
        evidence: { type: "string", description: "Completion evidence (required for complete)" },
        author: { type: "string", description: "Comment author" },
        status: { type: "string", enum: ["todo", "in_progress", "blocked", "done", "failed"], description: "Filter by status (for show)" },
        max_retries: { type: "number", description: "Max retries for new card (default 3)" },
      },
      required: ["action"],
    },
    execute: async (args) => {
      const action = String(args.action ?? "");

      switch (action) {
        case "show": {
          const cards = board.list(args.status as KanbanCard["status"] | undefined);
          if (cards.length === 0) return "Board is empty.";
          return cards.map(c => {
            const hb = c.lastHeartbeat ? ` | Last heartbeat: ${Math.round((Date.now() - c.lastHeartbeat) / 1000)}s ago` : "";
            const retries = c.retryCount > 0 ? ` | Retries: ${c.retryCount}/${c.maxRetries}` : "";
            return `[${c.status.toUpperCase()}] ${c.id}: ${c.title}\n  Assignee: ${c.assignee}${hb}${retries}\n  ${c.blockedBy.length ? `Blocked by: ${c.blockedBy.join(", ")}\n  ` : ""}${c.comments.length ? `Comments: ${c.comments.length}` : ""}`;
          }).join("\n\n");
        }
        case "create": {
          if (!args.title) return "Error: title required";
          const card = board.create(
            String(args.title),
            String(args.description ?? ""),
            String(args.assignee ?? "unassigned"),
            Number(args.max_retries ?? DEFAULT_MAX_RETRIES),
          );
          return `Created card ${card.id}: ${card.title} (max_retries: ${card.maxRetries})`;
        }
        case "assign": {
          if (!args.id || !args.assignee) return "Error: id and assignee required";
          return board.assign(String(args.id), String(args.assignee))
            ? `Card ${args.id} assigned to ${args.assignee}`
            : `Card ${args.id} not found`;
        }
        case "complete": {
          if (!args.id) return "Error: id required";
          const ok = board.complete(String(args.id), args.evidence ? String(args.evidence) : undefined);
          return ok
            ? `Card ${args.id} marked done`
            : `Card ${args.id} not found or completion rejected (provide evidence)`;
        }
        case "block": {
          if (!args.id || !args.blocked_by) return "Error: id and blocked_by required";
          return board.block(String(args.id), String(args.blocked_by), args.reason ? String(args.reason) : undefined)
            ? `Card ${args.id} blocked by ${args.blocked_by}`
            : `Card ${args.id} not found`;
        }
        case "unblock": {
          if (!args.id || !args.blocked_by) return "Error: id and blocked_by required";
          return board.unblock(String(args.id), String(args.blocked_by))
            ? `Card ${args.id} unblocked from ${args.blocked_by}`
            : `Card ${args.id} not found`;
        }
        case "heartbeat": {
          if (!args.id) return "Error: id required";
          return board.heartbeat(String(args.id), args.note ? String(args.note) : undefined)
            ? `Heartbeat for card ${args.id}`
            : `Card ${args.id} not found`;
        }
        case "comment": {
          if (!args.id || !args.note) return "Error: id and note required";
          return board.comment(String(args.id), String(args.author ?? "agent"), String(args.note))
            ? `Comment added to ${args.id}`
            : `Card ${args.id} not found`;
        }
        case "zombies": {
          const zombies = board.detectZombies();
          if (zombies.length === 0) return "No zombie tasks detected.";
          return `${zombies.length} zombie task(s):\n` + zombies.map(c =>
            `  ${c.id}: ${c.title} (assignee: ${c.assignee}, last heartbeat: ${Math.round((Date.now() - c.lastHeartbeat) / 1000)}s ago)`,
          ).join("\n");
        }
        case "reclaim": {
          const results = board.reclaimZombies();
          if (results.length === 0) return "No zombies to reclaim.";
          return results.map(r =>
            `  ${r.card.id}: ${r.card.title} → ${r.action}`,
          ).join("\n");
        }
        default:
          return `Error: unknown action "${action}"`;
      }
    },
    toolset: "system",
    emoji: "📋",
  };
}
