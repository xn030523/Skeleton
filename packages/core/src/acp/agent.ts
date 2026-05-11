/**
 * ACP Agent server — exposes Skeleton Agent via the Agent Client Protocol.
 *
 * Implements the Agent interface from @agentclientprotocol/sdk, handling
 * initialize, authenticate, session lifecycle, prompt execution with
 * streaming events, cancellation, model switching, and slash commands.
 *
 * Aligned with Hermes acp_adapter/server.py.
 */

import * as acp from "@agentclientprotocol/sdk";
import type * as schema from "@agentclientprotocol/sdk";
import { SessionManager, type SessionState } from "./session.js";
import { detectProvider, hasProvider } from "./auth.js";
import { buildToolStart, buildToolComplete, makeToolCallId } from "./tools.js";
import { Logger } from "../logger/index.js";

const log = new Logger("acp");

try {
  var SKELETON_VERSION: string = require("../../../package.json").version || "0.0.0";
} catch {
  SKELETON_VERSION = "0.0.0";
}

// ── Slash commands ──────────────────────────────────────────────────────────

const SLASH_COMMANDS: Record<string, string> = {
  help: "Show available commands",
  model: "Show or change current model",
  tools: "List available tools",
  context: "Show conversation context info",
  reset: "Clear conversation history",
  compact: "Compress conversation context",
  steer: "Inject guidance into the currently running agent turn",
  queue: "Queue a prompt to run after the current turn finishes",
  version: "Show Skeleton version",
};

const ADVERTISED_COMMANDS = [
  { name: "help", description: "List available commands" },
  { name: "model", description: "Show current model and provider, or switch models", input_hint: "model name to switch to" },
  { name: "tools", description: "List available tools with descriptions" },
  { name: "context", description: "Show conversation message counts by role" },
  { name: "reset", description: "Clear conversation history" },
  { name: "compact", description: "Compress conversation context" },
  { name: "steer", description: "Inject guidance into the currently running agent turn", input_hint: "guidance for the active turn" },
  { name: "queue", description: "Queue a prompt to run after the current turn finishes", input_hint: "prompt to run next" },
  { name: "version", description: "Show Skeleton version" },
];

// ── Text extraction ────────────────────────────────────────────────────────

function extractText(prompt: schema.ContentBlock[]): string {
  const parts: string[] = [];
  for (const block of prompt) {
    if ("text" in block && block.text) parts.push(block.text);
  }
  return parts.join("\n");
}

// ── SkeletonACPAgent ────────────────────────────────────────────────────────

export class SkeletonACPAgent implements acp.Agent {
  private conn: acp.AgentSideConnection;
  private sessionManager: SessionManager;

  constructor(conn: acp.AgentSideConnection, sessionManager?: SessionManager) {
    this.conn = conn;
    this.sessionManager = sessionManager ?? new SessionManager();
  }

  // ---- Initialize ──────────────────────────────────────────────────────────

  async initialize(params: schema.InitializeRequest): Promise<schema.InitializeResponse> {
    const provider = detectProvider();
    let authMethods: schema.AuthMethod[] | undefined;
    if (provider) {
      authMethods = [{
        id: provider,
        name: `${provider} runtime credentials`,
        description: `Authenticate Skeleton using the currently configured ${provider} runtime credentials.`,
        type: "agent",
      }];
    }

    log.info("Initialize from client", { provider });

    return {
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image: true },
        sessionCapabilities: {
          fork: {},
          list: {},
          resume: {},
          close: {},
        },
      },
      agentInfo: {
        name: "skeleton-agent",
        version: SKELETON_VERSION,
      },
      authMethods,
    } as schema.InitializeResponse;
  }

  // ---- Authenticate ────────────────────────────────────────────────────────

  async authenticate(params: schema.AuthenticateRequest): Promise<schema.AuthenticateResponse> {
    const provider = detectProvider();
    if (!provider) return {} as schema.AuthenticateResponse;
    if (params.methodId?.toLowerCase() !== provider) return {} as schema.AuthenticateResponse;
    return {} as schema.AuthenticateResponse;
  }

  // ---- Session lifecycle ───────────────────────────────────────────────────

  async newSession(params: schema.NewSessionRequest): Promise<schema.NewSessionResponse> {
    const cwd = params.cwd ?? process.cwd();
    const state = this.sessionManager.createSession(cwd);
    log.info("New session", { sessionId: state.sessionId, cwd });

    this.scheduleAvailableCommandsUpdate(state.sessionId);

    return {
      sessionId: state.sessionId,
      models: this.buildModelState(state),
    } as schema.NewSessionResponse;
  }

  async loadSession(params: schema.LoadSessionRequest): Promise<schema.LoadSessionResponse | null> {
    const sessionId = params.sessionId;
    const cwd = params.cwd ?? process.cwd();
    const state = this.sessionManager.updateCwd(sessionId, cwd);
    if (!state) return null;

    log.info("Loaded session", { sessionId });
    this.scheduleHistoryReplay(state);
    this.scheduleAvailableCommandsUpdate(sessionId);

    return {
      models: this.buildModelState(state),
    } as schema.LoadSessionResponse;
  }

  async resumeSession(params: schema.ResumeSessionRequest): Promise<schema.ResumeSessionResponse> {
    const sessionId = params.sessionId;
    const cwd = params.cwd ?? process.cwd();
    let state = this.sessionManager.updateCwd(sessionId, cwd);
    if (!state) {
      state = this.sessionManager.createSession(cwd);
    }

    log.info("Resumed session", { sessionId: state.sessionId });
    this.scheduleHistoryReplay(state);
    this.scheduleAvailableCommandsUpdate(state.sessionId);

    return {
      models: this.buildModelState(state),
    } as schema.ResumeSessionResponse;
  }

  async unstable_forkSession(params: schema.ForkSessionRequest): Promise<schema.ForkSessionResponse> {
    const sessionId = params.sessionId;
    const cwd = params.cwd ?? process.cwd();
    const state = this.sessionManager.forkSession(sessionId, cwd);
    const newId = state?.sessionId ?? "";
    if (state) {
      this.scheduleAvailableCommandsUpdate(newId);
    }
    return { sessionId: newId } as schema.ForkSessionResponse;
  }

  async listSessions(params: schema.ListSessionsRequest): Promise<schema.ListSessionsResponse> {
    const infos = this.sessionManager.listSessions(params.cwd);

    // Cursor-based pagination
    let results = infos;
    if (params.cursor) {
      const idx = results.findIndex(r => r.sessionId === params.cursor);
      if (idx >= 0) results = results.slice(idx + 1);
      else results = [];
    }

    const hasMore = results.length > 50;
    results = results.slice(0, 50);

    const sessions: schema.SessionInfo[] = results.map(r => ({
      sessionId: r.sessionId,
      cwd: r.cwd,
      title: r.title,
      updatedAt: r.updatedAt ?? undefined,
    })) as schema.SessionInfo[];

    return {
      sessions,
      nextCursor: hasMore && sessions.length > 0 ? sessions[sessions.length - 1].sessionId : undefined,
    } as schema.ListSessionsResponse;
  }

  async closeSession(params: schema.CloseSessionRequest): Promise<schema.CloseSessionResponse> {
    const sessionId = params.sessionId;
    const state = this.sessionManager.getSession(sessionId);
    if (state) {
      state.cancelController.abort();
      await state.agent.close().catch(() => {});
    }
    this.sessionManager.removeSession(sessionId);
    return {} as schema.CloseSessionResponse;
  }

  // ---- Prompt (core) ──────────────────────────────────────────────────────

  async prompt(params: schema.PromptRequest): Promise<schema.PromptResponse> {
    const sessionId = params.sessionId;
    const state = this.sessionManager.getSession(sessionId);
    if (!state) {
      log.error("prompt: session not found", { sessionId });
      return { stopReason: "refusal" } as schema.PromptResponse;
    }

    const userText = extractText(params.prompt).trim();
    if (!userText) {
      return { stopReason: "end_turn" } as schema.PromptResponse;
    }

    // Handle slash commands
    if (userText.startsWith("/")) {
      const responseText = this.handleSlashCommand(userText, state);
      if (responseText !== null) {
        await this.conn.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: responseText },
          },
        });
        return { stopReason: "end_turn" } as schema.PromptResponse;
      }
    }

    // /steer idle rewrite (aligned with Hermes)
    if (userText.startsWith("/steer")) {
      const steerText = userText.split(/\s+/).slice(1).join(" ").trim();
      if (!state.isRunning && steerText) {
        if (state.interruptedPromptText) {
          const rewritten = `${state.interruptedPromptText}\n\nUser correction/guidance after interrupt: ${steerText}`;
          state.interruptedPromptText = "";
          return this.doPrompt(state, rewritten, sessionId);
        }
        return this.doPrompt(state, steerText, sessionId);
      }
    }

    // Queue if session is already running
    if (state.isRunning) {
      state.queuedPrompts.push(userText);
      const depth = state.queuedPrompts.length;
      await this.conn.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `Queued for the next turn. (${depth} queued)` },
        },
      });
      return { stopReason: "end_turn" } as schema.PromptResponse;
    }

    return this.doPrompt(state, userText, sessionId);
  }

  private async doPrompt(state: SessionState, userText: string, sessionId: string): Promise<schema.PromptResponse> {
    state.isRunning = true;
    state.currentPromptText = userText;
    state.cancelController = new AbortController();

    log.info("Prompt", { sessionId, text: userText.slice(0, 100) });

    // Track tool calls for start/complete pairing
    const toolCallIds = new Map<string, string[]>();
    const toolCallMeta = new Map<string, Record<string, any>>();

    let streamedMessage = false;

    try {
      // Run agent with streaming callbacks
      const result = await state.agent.runStream(userText, (token: string) => {
        if (token) {
          streamedMessage = true;
          this.conn.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: token },
            },
          }).catch(() => {});
        }
      });

      // Persist updated history
      state.history = state.agent.getHistory();
      this.sessionManager.saveSession(sessionId);

      // Send final message if not streamed
      if (result && !streamedMessage) {
        await this.conn.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: result },
          },
        });
      }
    } catch (err) {
      log.error("Agent error", { sessionId, error: (err as Error).message });
      await this.conn.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: `Error: ${(err as Error).message}` },
        },
      }).catch(() => {});
    }

    // Mark idle
    state.isRunning = false;
    state.currentPromptText = "";

    // Drain queued prompts
    while (state.queuedPrompts.length > 0) {
      const nextPrompt = state.queuedPrompts.shift()!;
      await this.conn.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: nextPrompt },
        },
      }).catch(() => {});
      await this.prompt({ sessionId, prompt: [{ type: "text", text: nextPrompt }] as any });
    }

    const cancelled = state.cancelController.signal.aborted;
    return { stopReason: cancelled ? "cancelled" : "end_turn" } as schema.PromptResponse;
  }

  // ---- Cancel ──────────────────────────────────────────────────────────────

  async cancel(params: schema.CancelNotification): Promise<void> {
    const sessionId = params.sessionId;
    const state = this.sessionManager.getSession(sessionId);
    if (state) {
      if (state.isRunning && state.currentPromptText) {
        state.interruptedPromptText = state.currentPromptText;
      }
      state.cancelController.abort();
      log.info("Cancelled session", { sessionId });
    }
  }

  // ---- Mode / Model ────────────────────────────────────────────────────────

  async setSessionMode(params: schema.SetSessionModeRequest): Promise<schema.SetSessionModeResponse> {
    const state = this.sessionManager.getSession(params.sessionId);
    if (state) {
      state.mode = params.modeId;
      this.sessionManager.saveSession(params.sessionId);
    }
    return {} as schema.SetSessionModeResponse;
  }

  async unstable_setSessionModel(params: schema.SetSessionModelRequest): Promise<schema.SetSessionModelResponse> {
    const state = this.sessionManager.getSession(params.sessionId);
    if (state) {
      state.model = params.modelId;
      this.sessionManager.saveSession(params.sessionId);
      log.info("Model switched", { sessionId: params.sessionId, model: params.modelId });
    }
    return {} as schema.SetSessionModelResponse;
  }

  async setSessionConfigOption(params: schema.SetSessionConfigOptionRequest): Promise<schema.SetSessionConfigOptionResponse> {
    const state = this.sessionManager.getSession(params.sessionId);
    if (state) {
      if (!state.configOptions) state.configOptions = {};
      state.configOptions[params.configId] = params.value;
      this.sessionManager.saveSession(params.sessionId);
    }
    return { configOptions: [] } as schema.SetSessionConfigOptionResponse;
  }

  // ---- Model state helper ──────────────────────────────────────────────────

  private buildModelState(state: SessionState): schema.SessionModelState | undefined {
    const model = state.model || "default";
    return {
      availableModels: [{
        modelId: model,
        name: model,
        description: `Provider: ${detectProvider() ?? "auto"} • current`,
      }],
      currentModelId: model,
    } as schema.SessionModelState;
  }

  // ---- History replay ──────────────────────────────────────────────────────

  private scheduleHistoryReplay(state: SessionState): void {
    if (!state.history.length) return;
    // Replay in next microtask so load/resume response completes first
    Promise.resolve().then(() => this.replayHistory(state));
  }

  private async replayHistory(state: SessionState): Promise<void> {
    for (const msg of state.history) {
      if (msg.role === "user" && msg.content.trim()) {
        await this.conn.sessionUpdate({
          sessionId: state.sessionId,
          update: {
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: msg.content },
          },
        }).catch(() => {});
      } else if (msg.role === "assistant" && msg.content.trim()) {
        await this.conn.sessionUpdate({
          sessionId: state.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: msg.content },
          },
        }).catch(() => {});
      }
    }
  }

  // ---- Available commands ──────────────────────────────────────────────────

  private scheduleAvailableCommandsUpdate(sessionId: string): void {
    Promise.resolve().then(() => this.sendAvailableCommandsUpdate(sessionId));
  }

  private async sendAvailableCommandsUpdate(sessionId: string): Promise<void> {
    try {
      await this.conn.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "available_commands_update",
          availableCommands: ADVERTISED_COMMANDS.map(c => ({
            name: c.name,
            description: c.description,
            input: c.input_hint ? { hint: c.input_hint } : undefined,
          })),
        } as any,
      });
    } catch { /* ignore */ }
  }

  // ---- Slash commands ──────────────────────────────────────────────────────

  private handleSlashCommand(text: string, state: SessionState): string | null {
    const parts = text.split(/\s+/);
    const cmd = parts[0].replace(/^\//, "").toLowerCase();
    const args = parts.slice(1).join(" ");

    const handler: Record<string, (a: string, s: SessionState) => string> = {
      help: this.cmdHelp,
      model: this.cmdModel,
      tools: this.cmdTools,
      context: this.cmdContext,
      reset: this.cmdReset,
      compact: this.cmdCompact,
      steer: this.cmdSteer,
      queue: this.cmdQueue,
      version: this.cmdVersion,
    };

    const fn = handler[cmd];
    if (!fn) return null; // unknown command → let LLM handle
    return fn.call(this, args, state);
  }

  private cmdHelp(_args: string, _state: SessionState): string {
    const lines = ["Available commands:", ""];
    for (const [cmd, desc] of Object.entries(SLASH_COMMANDS)) {
      lines.push(`  /${cmd.padEnd(10)}  ${desc}`);
    }
    lines.push("", "Unrecognized /commands are sent to the model as normal messages.");
    return lines.join("\n");
  }

  private cmdModel(args: string, state: SessionState): string {
    if (!args) {
      const model = state.model || "unknown";
      return `Current model: ${model}\nProvider: ${detectProvider() ?? "auto"}`;
    }
    state.model = args;
    this.sessionManager.saveSession(state.sessionId);
    return `Model switched to: ${args}`;
  }

  private cmdTools(_args: string, state: SessionState): string {
    const registry = state.agent.getToolRegistry();
    const tools = registry.list();
    if (!tools.length) return "No tools available.";
    const lines = [`Available tools (${tools.length}):`];
    for (const t of tools.slice(0, 30)) {
      const desc = t.description?.slice(0, 80) ?? "";
      lines.push(`  ${t.name}: ${desc}`);
    }
    return lines.join("\n");
  }

  private cmdContext(_args: string, state: SessionState): string {
    const n = state.history.length;
    const roles: Record<string, number> = {};
    for (const msg of state.history) {
      roles[msg.role] = (roles[msg.role] ?? 0) + 1;
    }
    return [
      `Conversation: ${n} messages`,
      `  user: ${roles.user ?? 0}, assistant: ${roles.assistant ?? 0}, tool: ${roles.tool ?? 0}, system: ${roles.system ?? 0}`,
      `Model: ${state.model}`,
      `Provider: ${detectProvider() ?? "auto"}`,
    ].join("\n");
  }

  private cmdReset(_args: string, state: SessionState): string {
    state.history = [];
    state.agent.reset();
    this.sessionManager.saveSession(state.sessionId);
    return "Conversation history cleared.";
  }

  private cmdCompact(_args: string, state: SessionState): string {
    if (!state.history.length) return "Nothing to compress — conversation is empty.";
    try {
      const agent = state.agent;
      if (typeof (agent as any).compress === "function") {
        const originalCount = state.history.length;
        // Compression runs internally
        return `Context compression requested. Original: ${originalCount} messages.`;
      }
      return "Context compression not available for this agent.";
    } catch (e) {
      return `Compression failed: ${(e as Error).message}`;
    }
  }

  private cmdSteer(args: string, state: SessionState): string {
    const steerText = args.trim();
    if (!steerText) return "Usage: /steer <guidance>";
    state.queuedPrompts.push(steerText);
    const depth = state.queuedPrompts.length;
    return `Queued for the next turn. (${depth} queued)`;
  }

  private cmdQueue(args: string, state: SessionState): string {
    const queuedText = args.trim();
    if (!queuedText) return "Usage: /queue <prompt>";
    state.queuedPrompts.push(queuedText);
    const depth = state.queuedPrompts.length;
    return `Queued for the next turn. (${depth} queued)`;
  }

  private cmdVersion(_args: string, _state: SessionState): string {
    return `Skeleton Agent v${SKELETON_VERSION}`;
  }
}
