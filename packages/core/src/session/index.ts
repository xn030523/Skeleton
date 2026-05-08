import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import type { Message } from "../types.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  parent_session_id TEXT,
  title TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  tool_call_id TEXT,
  tool_calls_json TEXT,
  tool_name TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Dual FTS5: unicode61 for Latin, trigram for CJK/substring matching
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  content=messages,
  content_rowid=id,
  tokenize='unicode61'
);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts_trigram USING fts5(
  content,
  content=messages,
  content_rowid=id,
  tokenize='trigram'
);

-- Auto-sync triggers for unicode61 FTS
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, content) VALUES('delete', old.id, old.content);
  INSERT INTO messages_fts(rowid, content) VALUES (new.id, new.content);
END;

-- Auto-sync triggers for trigram FTS
CREATE TRIGGER IF NOT EXISTS messages_ai_tri AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts_trigram(rowid, content) VALUES (new.id, new.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_ad_tri AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts_trigram(messages_fts_trigram, rowid, content) VALUES('delete', old.id, old.content);
END;
CREATE TRIGGER IF NOT EXISTS messages_au_tri AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts_trigram(messages_fts_trigram, rowid, content) VALUES('delete', old.id, old.content);
  INSERT INTO messages_fts_trigram(rowid, content) VALUES (new.id, new.content);
END;

CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);
`;

export interface SessionSummary {
  sessionId: string;
  title: string | null;
  createdAt: string;
  messageCount: number;
  relevantExcerpt: string;
}

export class SessionDB {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolved = dbPath ?? path.join(process.cwd(), ".skeleton", "sessions.db");
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    this.db = new Database(resolved);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = OFF");
    this.db.exec(SCHEMA);
  }

  createSession(id: string, title?: string, parentSessionId?: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO sessions (id, title, parent_session_id) VALUES (?, ?, ?)")
      .run(id, title ?? null, parentSessionId ?? null);
  }

  saveMessage(sessionId: string, msg: Message, toolName?: string): void {
    this.db
      .prepare(
        "INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls_json, tool_name) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        sessionId,
        msg.role,
        msg.content,
        msg.toolCallId ?? null,
        msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
        toolName ?? null,
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

  /** Get the latest child session in the compression chain */
  getCompressionTip(sessionId: string): string {
    let current = sessionId;
    let iterations = 0;
    while (iterations < 100) {
      const child = this.db
        .prepare("SELECT id FROM sessions WHERE parent_session_id = ? ORDER BY created_at DESC LIMIT 1")
        .get(current) as { id: string } | undefined;
      if (!child) break;
      current = child.id;
      iterations++;
    }
    return current;
  }

  /** Search across all sessions — tries both unicode61 and trigram FTS */
  search(query: string, limit = 20): Array<{ sessionId: string; content: string; role: string; createdAt: string }> {
    // Sanitize FTS5 query
    const safe = query
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1)
      .join(" OR ");

    if (!safe) return [];

    // Try unicode61 first, fall back to trigram for CJK/substring
    try {
      const results = this.db
        .prepare(
          `SELECT m.session_id, m.content, m.role, m.created_at
           FROM messages_fts f
           JOIN messages m ON m.id = f.rowid
           WHERE messages_fts MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(safe, limit) as Array<{ sessionId: string; content: string; role: string; createdAt: string }>;

      if (results.length > 0) return results;
    } catch {
      // unicode61 failed, try trigram
    }

    try {
      return this.db
        .prepare(
          `SELECT m.session_id, m.content, m.role, m.created_at
           FROM messages_fts_trigram f
           JOIN messages m ON m.id = f.rowid
           WHERE messages_fts_trigram MATCH ?
           ORDER BY rank
           LIMIT ?`,
        )
        .all(query, limit) as Array<{ sessionId: string; content: string; role: string; createdAt: string }>;
    } catch {
      return [];
    }
  }

  /** Build session summaries for cross-session context injection */
  buildSessionContext(query: string, maxTokens = 2000): string {
    const results = this.search(query, 30);
    if (results.length === 0) return "";

    // Group by session, take most relevant message per session
    const seen = new Set<string>();
    const excerpts: Array<{ sessionId: string; content: string; role: string; createdAt: string }> = [];
    for (const r of results) {
      if (seen.has(r.sessionId)) continue;
      if (r.role === "tool") continue; // skip tool results
      seen.add(r.sessionId);
      excerpts.push(r);
    }

    if (excerpts.length === 0) return "";

    const lines = excerpts.map(
      (e) => `[${e.role}, ${e.createdAt.slice(0, 10)}] ${truncate(e.content, 200)}`,
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
      ? `## Past Sessions (relevant history)\n${selected.join("\n")}\n\nUse session_search tool for deeper lookup.`
      : "";
  }

  /** Get recent sessions with message counts */
  recentSessions(limit = 10): Array<{ id: string; title: string | null; createdAt: string; messageCount: number }> {
    return this.db
      .prepare(
        `SELECT s.id, s.title, s.created_at, COUNT(m.id) as message_count
         FROM sessions s
         LEFT JOIN messages m ON m.session_id = s.id
         GROUP BY s.id
         ORDER BY s.created_at DESC
         LIMIT ?`,
      )
      .all(limit) as Array<{ id: string; title: string | null; createdAt: string; messageCount: number }>;
  }

  close(): void {
    this.db.close();
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + "...";
}
