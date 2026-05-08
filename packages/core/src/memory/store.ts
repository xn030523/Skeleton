import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS memories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  content TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  source TEXT DEFAULT 'auto',
  use_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  content=memories,
  content_rowid=id,
  tokenize='unicode61'
);

CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
`;

export interface MemoryEntry {
  id: number;
  content: string;
  category: string;
  source: string;
  useCount: number;
  createdAt: string;
}

export type MemoryCategory =
  | "general"
  | "finding"
  | "technique"
  | "preference"
  | "project"
  | "environment"
  | "tool_result"
  | "lesson";

export class MemoryStore {
  private db: Database.Database;
  private snapshot: string | null = null;

  constructor(dbPath?: string) {
    const resolved = dbPath ?? path.join(process.cwd(), ".skeleton", "memory.db");
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    this.db = new Database(resolved);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  /** Freeze current memory context — subsequent writes go to DB but don't mutate snapshot.
   *  This preserves prefix cache consistency for the LLM system prompt. */
  freezeSnapshot(): string {
    this.snapshot = this.buildContextInner(4000);
    return this.snapshot;
  }

  /** Get the frozen snapshot (captured at session start). Returns live context if not frozen. */
  getSnapshot(): string {
    return this.snapshot ?? this.buildContextInner(4000);
  }

  add(content: string, category: MemoryCategory | string = "general", source = "auto"): number {
    if (this.exists(content)) return -1;
    const result = this.db
      .prepare("INSERT INTO memories (content, category, source) VALUES (?, ?, ?)")
      .run(content, category, source);
    return Number(result.lastInsertRowid);
  }

  exists(content: string): boolean {
    const prefix = content.slice(0, 40).replace(/%/g, "");
    const row = this.db
      .prepare("SELECT 1 FROM memories WHERE content LIKE ? LIMIT 1")
      .get(`${prefix}%`);
    return !!row;
  }

  remove(keyword: string): number {
    const rows = this.db
      .prepare("SELECT id FROM memories WHERE content LIKE ?")
      .all(`%${keyword}%`) as Array<{ id: number }>;
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return 0;
    this.db.prepare(`DELETE FROM memories WHERE id IN (${ids.map(() => "?").join(",")})`).run(...ids);
    return ids.length;
  }

  search(query: string, limit = 10): MemoryEntry[] {
    const safe = query
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .join(" OR ");
    if (!safe) return [];
    try {
      return this.db
        .prepare(
          `SELECT m.* FROM memories m
           JOIN memories_fts f ON m.id = f.rowid
           WHERE memories_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(safe, limit) as MemoryEntry[];
    } catch {
      return [];
    }
  }

  list(category?: string): MemoryEntry[] {
    if (category) {
      return this.db
        .prepare("SELECT * FROM memories WHERE category = ? ORDER BY updated_at DESC")
        .all(category) as MemoryEntry[];
    }
    return this.db
      .prepare("SELECT * FROM memories ORDER BY updated_at DESC LIMIT 100")
      .all() as MemoryEntry[];
  }

  touch(id: number): void {
    this.db
      .prepare("UPDATE memories SET use_count = use_count + 1, updated_at = datetime('now') WHERE id = ?")
      .run(id);
  }

  /** Consolidate: merge memories in the same category that share significant keyword overlap. */
  consolidate(category?: string): number {
    const memories = category
      ? this.list(category)
      : this.list();
    if (memories.length < 2) return 0;

    const merged: Map<number, number[]> = new Map();
    const visited = new Set<number>();
    let mergeCount = 0;

    for (let i = 0; i < memories.length; i++) {
      if (visited.has(memories[i].id)) continue;
      const group = [memories[i].id];
      const words = extractKeywords(memories[i].content);

      for (let j = i + 1; j < memories.length; j++) {
        if (visited.has(memories[j].id)) continue;
        const otherWords = extractKeywords(memories[j].content);
        const overlap = words.filter((w) => otherWords.includes(w));
        if (overlap.length >= Math.min(3, Math.ceil(words.length * 0.4))) {
          group.push(memories[j].id);
          visited.add(memories[j].id);
        }
      }

      if (group.length > 1) {
        merged.set(memories[i].id, group);
        mergeCount++;
      }
    }

    // Perform merges
    const mergeStmt = this.db.prepare(
      "UPDATE memories SET content = ?, updated_at = datetime('now') WHERE id = ?"
    );
    const deleteStmt = this.db.prepare("DELETE FROM memories WHERE id = ?");

    for (const [keepId, ids] of merged) {
      const entries = ids
        .map((id) => memories.find((m) => m.id === id)!)
        .filter(Boolean);
      const combined = entries
        .map((e) => e.content)
        .join("; ");
      mergeStmt.run(combined.slice(0, 2000), keepId);
      for (const id of ids) {
        if (id !== keepId) deleteStmt.run(id);
      }
    }

    return mergeCount;
  }

  buildContext(maxTokens = 2000): string {
    return this.buildContextInner(maxTokens);
  }

  private buildContextInner(maxTokens: number): string {
    const memories = this.db
      .prepare("SELECT * FROM memories ORDER BY use_count DESC, updated_at DESC LIMIT 50")
      .all() as MemoryEntry[];

    if (memories.length === 0) return "";

    const lines = memories.map(
      (m) => `[${m.category}] ${m.content} (used ${m.useCount}x)`,
    );

    let total = 0;
    const selected: string[] = [];
    for (const line of lines) {
      const tokens = Math.ceil(line.length / 4);
      if (total + tokens > maxTokens) break;
      selected.push(line);
      total += tokens;
    }

    return selected.length > 0
      ? `## Memories (knowledge from past sessions)\n${selected.join("\n")}`
      : "";
  }

  close(): void {
    this.db.close();
  }
}

function extractKeywords(text: string): string[] {
  const stopWords = new Set(["the", "a", "an", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "can", "shall", "to", "of", "in", "for", "on", "with",
    "at", "by", "from", "as", "into", "through", "during", "before", "after", "and",
    "but", "or", "not", "no", "nor", "so", "if", "then", "that", "this", "these",
    "those", "it", "its", "this", "that", "i", "you", "we", "they", "me", "him", "her",
    "us", "them", "my", "your", "his", "our", "their"]);
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stopWords.has(w));
}
