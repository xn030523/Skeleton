import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type { Message } from "../types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  created_at TEXT DEFAULT (datetime('now')),
  title TEXT
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_call_id TEXT,
  tool_calls_json TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content=messages,
  content_rowid=id,
  tokenize='unicode61'
);
`;

export class SessionDB {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolved = dbPath ?? path.join(process.cwd(), ".skeleton", "sessions.db");
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    this.db = new Database(resolved);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  createSession(id: string, title?: string): void {
    this.db.prepare("INSERT OR IGNORE INTO sessions (id, title) VALUES (?, ?)").run(id, title ?? null);
  }

  saveMessage(sessionId: string, msg: Message): void {
    this.db
      .prepare(
        "INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls_json) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        sessionId,
        msg.role,
        msg.content,
        msg.toolCallId ?? null,
        msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
      );
  }

  getMessages(sessionId: string): Message[] {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC")
      .all(sessionId) as Array<{
      role: string;
      content: string;
      tool_call_id: string | null;
      tool_calls_json: string | null;
    }>;

    return rows.map((r) => ({
      role: r.role as Message["role"],
      content: r.content,
      toolCallId: r.tool_call_id ?? undefined,
      toolCalls: r.tool_calls_json ? JSON.parse(r.tool_calls_json) : undefined,
    }));
  }

  search(query: string, limit = 20): Array<{ sessionId: string; content: string; role: string }> {
    return this.db
      .prepare(
        `SELECT m.session_id, m.content, m.role
         FROM messages_fts f
         JOIN messages m ON m.id = f.rowid
         WHERE messages_fts MATCH ?
         ORDER BY rank
         LIMIT ?`,
      )
      .all(query, limit) as Array<{ sessionId: string; content: string; role: string }>;
  }

  close(): void {
    this.db.close();
  }
}
