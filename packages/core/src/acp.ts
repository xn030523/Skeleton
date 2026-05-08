/**
 * Agent Client Protocol (ACP) adapter — expose Skeleton Agent
 * via ACP for integration with ACP-compatible clients.
 *
 * Supports session lifecycle (new/list/fork/resume), streaming,
 * tool calls, and model switching.
 *
 * Inspired by Hermes acp_adapter/ (simplified).
 */

import type { AgentConfig } from "./types.js";
import { Agent } from "./agent.js";
import { MemoryStore } from "./memory/store.js";
import { UserProfile } from "./memory/user-profile.js";

export interface AcpSession {
  id: string;
  agent: Agent;
  createdAt: number;
  parentId?: string;
}

export class AcpServer {
  private sessions = new Map<string, AcpSession>();
  private config: AgentConfig;
  private memory?: MemoryStore;
  private userProfile?: UserProfile;
  private sessionCounter = 0;

  constructor(config: AgentConfig, memory?: MemoryStore, userProfile?: UserProfile) {
    this.config = config;
    this.memory = memory;
    this.userProfile = userProfile;
  }

  /** Create a new ACP session */
  async newSession(parentId?: string): Promise<AcpSession> {
    const id = `acp_${++this.sessionCounter}_${Date.now().toString(36)}`;
    const agent = new Agent(this.config, this.memory ?? undefined, this.userProfile ?? undefined);
    const session: AcpSession = {
      id,
      agent,
      createdAt: Date.now(),
      parentId,
    };
    this.sessions.set(id, session);
    return session;
  }

  /** List active sessions */
  listSessions(): Array<{ id: string; createdAt: number; parentId?: string }> {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      createdAt: s.createdAt,
      parentId: s.parentId,
    }));
  }

  /** Get an existing session */
  getSession(id: string): AcpSession | null {
    return this.sessions.get(id) ?? null;
  }

  /** Fork a session (copy conversation state) */
  async forkSession(parentId: string): Promise<AcpSession | null> {
    const parent = this.sessions.get(parentId);
    if (!parent) return null;

    const forked = await this.newSession(parentId);
    // Copy conversation history
    const history = parent.agent.getHistory();
    for (const msg of history) {
      forked.agent.getHistory().push(msg); // Bypass — direct push
    }
    return forked;
  }

  /** Resume a session (re-activate) */
  resumeSession(id: string): AcpSession | null {
    return this.sessions.get(id) ?? null;
  }

  /** Send a message to a session and get response */
  async sendMessage(sessionId: string, message: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.agent.run(message);
  }

  /** Stream a message to a session */
  async streamMessage(
    sessionId: string,
    message: string,
    onToken: (token: string) => void,
  ): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);
    return session.agent.runStream(message, onToken);
  }

  /** Close and remove a session */
  async closeSession(id: string): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return false;
    await session.agent.close();
    this.sessions.delete(id);
    return true;
  }

  /** Get session count */
  get sessionCount(): number {
    return this.sessions.size;
  }
}
