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

export class MemoryStore {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolved = dbPath ?? path.join(process.cwd(), ".skeleton", "memory.db");
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    this.db = new Database(resolved);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  add(content: string, category = "general", source = "auto"): number {
    // Dedup: skip if very similar content already exists
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
    // Sanitize FTS5 query: strip special chars, keep words
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

  buildContext(maxTokens = 2000): string {
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
