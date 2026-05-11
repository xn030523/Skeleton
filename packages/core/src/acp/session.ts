/**
 * ACP session manager — maps ACP sessions to Skeleton Agent instances.
 *
 * Sessions are persisted to the shared SessionDB (~/.skeleton/sessions.db)
 * so they survive process restarts. When the editor reconnects after
 * idle/restart, the load/resume calls find the persisted session in the
 * database and restore the full conversation history.
 *
 * Aligned with Hermes acp_adapter/session.py.
 */

import crypto from "node:crypto";
import { loadConfig } from "../config/index.js";
import { Agent } from "../agent.js";
import { MemoryStore } from "../memory/store.js";
import { UserProfile } from "../memory/user-profile.js";
import { SessionDB } from "../session/index.js";
import { findProvider } from "../providers/registry.js";
import type { AgentConfig, Message } from "../types.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SessionState {
  sessionId: string;
  agent: Agent;
  cwd: string;
  model: string;
  history: Message[];
  cancelController: AbortController;
  isRunning: boolean;
  queuedPrompts: string[];
  currentPromptText: string;
  interruptedPromptText: string;
  mode?: string;
  configOptions?: Record<string, string>;
}

const LIST_SESSIONS_PAGE_SIZE = 50;

// ── SessionManager ──────────────────────────────────────────────────────────

export class SessionManager {
  private sessions = new Map<string, SessionState>();
  private db: SessionDB | null = null;

  constructor(db?: SessionDB) {
    if (db) this.db = db;
  }

  private getDb(): SessionDB | null {
    if (this.db) return this.db;
    try {
      this.db = new SessionDB();
      return this.db;
    } catch {
      return null;
    }
  }

  // ---- public API ──────────────────────────────────────────────────────────

  createSession(cwd: string = "."): SessionState {
    const sessionId = crypto.randomUUID();
    const agent = this.makeAgent(sessionId, cwd);
    const model = (agent as any).model ?? (loadConfig().llm as any).model ?? "";

    const state: SessionState = {
      sessionId,
      agent,
      cwd,
      model,
      history: [],
      cancelController: new AbortController(),
      isRunning: false,
      queuedPrompts: [],
      currentPromptText: "",
      interruptedPromptText: "",
    };

    this.sessions.set(sessionId, state);
    this.persist(state);
    return state;
  }

  getSession(sessionId: string): SessionState | null {
    const state = this.sessions.get(sessionId);
    if (state) return state;
    return this.restore(sessionId);
  }

  removeSession(sessionId: string): boolean {
    const existed = this.sessions.delete(sessionId);
    this.deletePersisted(sessionId);
    return existed;
  }

  forkSession(sessionId: string, cwd: string = "."): SessionState | null {
    const original = this.getSession(sessionId);
    if (!original) return null;

    const newId = crypto.randomUUID();
    const agent = this.makeAgent(newId, cwd, original.model);
    const state: SessionState = {
      sessionId: newId,
      agent,
      cwd,
      model: original.model,
      history: structuredClone(original.history),
      cancelController: new AbortController(),
      isRunning: false,
      queuedPrompts: [],
      currentPromptText: "",
      interruptedPromptText: "",
    };

    this.sessions.set(newId, state);
    this.persist(state);
    return state;
  }

  listSessions(cwd?: string): Array<{
    sessionId: string;
    cwd: string;
    model: string;
    historyLen: number;
    title: string;
    updatedAt: string | null;
  }> {
    const results: Array<{
      sessionId: string;
      cwd: string;
      model: string;
      historyLen: number;
      title: string;
      updatedAt: string | null;
    }> = [];

    // In-memory sessions
    for (const s of this.sessions.values()) {
      if (s.history.length <= 0) continue;
      if (cwd && s.cwd !== cwd) continue;
      const preview = s.history.find(m => m.role === "user" && m.content.trim())?.content.trim() ?? "";
      results.push({
        sessionId: s.sessionId,
        cwd: s.cwd,
        model: s.model,
        historyLen: s.history.length,
        title: preview.slice(0, 80) || s.cwd.split(/[/\\]/).pop() || "New thread",
        updatedAt: new Date().toISOString(),
      });
    }

    // Persisted sessions not in memory
    const db = this.getDb();
    if (db) {
      try {
        const persisted = db.recentSessions(1000);
        const seenIds = new Set(this.sessions.keys());
        for (const row of persisted) {
          if (seenIds.has(row.id)) continue;
          if (row.messageCount <= 0) continue;
          results.push({
            sessionId: row.id,
            cwd: ".",
            model: "",
            historyLen: row.messageCount,
            title: row.title || "Untitled session",
            updatedAt: row.createdAt,
          });
        }
      } catch { /* ignore DB errors */ }
    }

    results.sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
    return results;
  }

  updateCwd(sessionId: string, cwd: string): SessionState | null {
    const state = this.getSession(sessionId);
    if (!state) return null;
    state.cwd = cwd;
    this.persist(state);
    return state;
  }

  saveSession(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (state) this.persist(state);
  }

  cleanup(): void {
    const ids = [...this.sessions.keys()];
    this.sessions.clear();
    for (const id of ids) {
      this.deletePersisted(id);
    }
  }

  // ---- persistence ───────────────────────────────────────────────────────

  private persist(state: SessionState): void {
    const db = this.getDb();
    if (!db) return;

    try {
      db.createSession(state.sessionId, undefined, undefined);
      // Atomic replace — avoids duplicate message accumulation across saves
      db.replaceMessages(state.sessionId, state.history);
    } catch { /* ignore persistence errors */ }
  }

  private restore(sessionId: string): SessionState | null {
    const db = this.getDb();
    if (!db) return null;

    try {
      const messages = db.getMessages(sessionId);
      if (messages.length === 0) return null;

      const cwd = process.cwd();
      const agent = this.makeAgent(sessionId, cwd);
      const model = (agent as any).model ?? "";

      const state: SessionState = {
        sessionId,
        agent,
        cwd,
        model,
        history: messages,
        cancelController: new AbortController(),
        isRunning: false,
        queuedPrompts: [],
        currentPromptText: "",
        interruptedPromptText: "",
      };

      this.sessions.set(sessionId, state);
      return state;
    } catch {
      return null;
    }
  }

  private deletePersisted(sessionId: string): void {
    // SessionDB doesn't expose deleteSession; skip for now
  }

  // ---- agent factory ──────────────────────────────────────────────────────

  private makeAgent(sessionId: string, cwd: string, model?: string): Agent {
    const config = loadConfig();
    const memory = new MemoryStore();
    const userProfile = new UserProfile();

    if (model) {
      (config.llm as any).model = model;
    }

    const agent = new Agent(config, memory, userProfile);

    // Route any incidental agent output to stderr (stdout is reserved for JSON-RPC)
    (agent as any)._printFn = (...args: any[]) => {
      process.stderr.write(args.join(" ") + "\n");
    };

    return agent;
  }
}
