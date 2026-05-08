import type { AgentConfig, Message, NormalizedResponse, ToolDef } from "./types.js";
import { ChatCompletionsTransport } from "./transports/chat-completions.js";
import { AnthropicTransport } from "./transports/anthropic.js";
import type { Transport } from "./transports/base.js";
import { ToolRegistry } from "./tools/registry.js";
import { ApprovalSystem } from "./tools/approval.js";
import { MemoryStore } from "./memory/store.js";
import { UserProfile } from "./memory/user-profile.js";
import { memoryTools } from "./memory/tools.js";
import { WorkingMemory } from "./memory/working.js";
import { workingMemoryTools } from "./memory/working-tools.js";
import { HonchoUserModel } from "./memory/honcho.js";
import { honchoTools } from "./memory/honcho-tools.js";
import { SkillRegistry, type SkillConfig } from "./skills/index.js";
import { registerCtfSkills } from "./skills/ctf/index.js";
import { skillManageTool, skillViewTool, skillResourceTool } from "./skills/tools.js";
import type { CronStore } from "./cron/store.js";
import { cronManageTool } from "./cron/tools.js";
import { delegateTaskTool } from "./sub-agent/tools.js";
import type { SessionDB } from "./session/index.js";
import { sessionSearchTool, recentSessionsTool } from "./session/tools.js";
import { ProjectContext } from "./context/index.js";

export class Agent {
  private transport: Transport;
  private fallbackTransport: Transport | null;
  private messages: Message[] = [];
  private toolRegistry: ToolRegistry;
  private maxTurns: number;
  private toolCallCount = 0;
  private basePrompt: string;
  private memory: MemoryStore | null;
  private userProfile: UserProfile | null;
  private frozenMemorySnapshot: string;
  private frozenUserSnapshot: string;
  private skillRegistry: SkillRegistry;
  private skillMode: "all" | "catalog";
  private mcpClients: unknown[] = [];
  private sessionDb: SessionDB | null;
  private sessionId: string;
  private projectContext: ProjectContext;
  private workingMemory: WorkingMemory;
  private approval: ApprovalSystem;
  private honcho: HonchoUserModel;

  constructor(
    config: AgentConfig & { skills?: SkillConfig },
    memory?: MemoryStore,
    userProfile?: UserProfile,
    cronStore?: CronStore,
    sessionDb?: SessionDB,
    projectContext?: ProjectContext,
    honcho?: HonchoUserModel,
  ) {
    this.transport = this.createTransport(config.llm);
    this.fallbackTransport = config.fallback ? this.createTransport(config.fallback) : null;
    this.toolRegistry = new ToolRegistry(config.tools ?? []);
    this.maxTurns = config.maxTurns ?? 20;
    this.basePrompt = config.systemPrompt ?? "You are Skeleton, a reverse engineering AI assistant.";
    this.memory = memory ?? null;
    this.userProfile = userProfile ?? null;
    this.sessionDb = sessionDb ?? null;
    this.sessionId = `sess_${Date.now().toString(36)}`;
    this.projectContext = projectContext ?? new ProjectContext();
    this.workingMemory = new WorkingMemory();
    this.approval = new ApprovalSystem();
    this.honcho = honcho ?? new HonchoUserModel();

    // Register Honcho dialectical tools
    for (const tool of honchoTools(this.honcho)) {
      this.toolRegistry.register(tool);
    }

    // Register working memory tools
    for (const tool of workingMemoryTools(this.workingMemory)) {
      this.toolRegistry.register(tool);
    }

    // Freeze snapshots at session start for prefix cache consistency
    this.frozenMemorySnapshot = this.memory ? this.memory.freezeSnapshot() : "";
    this.frozenUserSnapshot = this.userProfile ? this.userProfile.freezeSnapshot() : "";

    // Register memory tools so the LLM can save/search memories
    if (this.memory && this.userProfile) {
      for (const tool of memoryTools(this.memory, this.userProfile)) {
        this.toolRegistry.register(tool);
      }
    }

    // Skill registry — register all skill groups + load agent-created from disk
    this.skillRegistry = new SkillRegistry();
    const skillConfig = config.skills ?? { ctf: true };
    this.skillMode = skillConfig.ctf === "auto" ? "catalog" : "all";

    if (skillConfig.ctf !== false) {
      registerCtfSkills(this.skillRegistry);
    }
    // Load user-created skills from disk
    this.skillRegistry.loadFromDisk();
    // Register skill_manage tool so LLM can create/edit/delete skills
    this.toolRegistry.register(skillManageTool(this.skillRegistry));
    // Register Tier 2+3 progressive disclosure tools (agentskills.io)
    this.toolRegistry.register(skillViewTool(this.skillRegistry));
    this.toolRegistry.register(skillResourceTool(this.skillRegistry));

    // Register cron_manage tool if store provided
    if (cronStore) {
      this.toolRegistry.register(cronManageTool(cronStore));
    }

    // Register delegate_task tool for sub-agent spawning
    this.toolRegistry.register(delegateTaskTool(config, () => this.toolRegistry.list()));

    // Register session search tools if SessionDB provided
    if (this.sessionDb) {
      this.sessionDb.createSession(this.sessionId);
      this.toolRegistry.register(sessionSearchTool(this.sessionDb));
      this.toolRegistry.register(recentSessionsTool(this.sessionDb));
    }
  }

  private buildSystemPrompt(userQuery?: string): string {
    let prompt = this.basePrompt;

    if (this.skillRegistry.list().length > 0) {
      if (this.skillMode === "all") {
        prompt += "\n\n## Skills (mandatory)\nIf a skill matches or is even partially relevant to your task, you MUST apply its workflow and techniques.\n";
        prompt += this.skillRegistry.loadAll();
      } else {
        prompt += "\n\n## Skills (mandatory)\nIf a skill matches or is even partially relevant to your task, you MUST apply its workflow and techniques.\n";
        prompt += this.skillRegistry.buildCatalog();
        prompt += "\n\nWhen you identify a skill category that matches the challenge, apply the techniques described in that skill's content. You have full knowledge of all listed skills built into your training — use them proactively.\n";
      }
    }

    // Inject frozen memory snapshot (captured at session start — prefix cache stable)
    if (this.frozenMemorySnapshot) {
      prompt += `\n\n${this.frozenMemorySnapshot}`;
    }
    if (this.frozenUserSnapshot) {
      prompt += `\n\n${this.frozenUserSnapshot}`;
    }

    // Honcho dialectical user model
    const honchoCtx = this.honcho.buildContext();
    if (honchoCtx) prompt += `\n\n${honchoCtx}`;

    // Cross-session recall: inject relevant past session context
    if (this.sessionDb && userQuery) {
      const sessionCtx = this.sessionDb.buildSessionContext(userQuery);
      if (sessionCtx) prompt += `\n\n${sessionCtx}`;
    }

    // Project context (from SKELETON.md / AGENTS.md)
    const projCtx = this.projectContext.buildContext();
    if (projCtx) prompt += `\n\n${projCtx}`;

    // Working memory (in-session task tracking)
    const workCtx = this.workingMemory.buildContext();
    if (workCtx) prompt += `\n\n${workCtx}`;

    // Closed-loop learning guidance
    prompt += "\n\n## Learning Guidelines\n" +
      "1. After completing complex multi-step tasks, consider creating a reusable skill with skill_manage.\n" +
      "2. Save important discoveries to memory with save_memory (use category 'finding' for discoveries, 'technique' for methods, 'preference' for user preferences).\n" +
      "3. Search past sessions with session_search before attempting similar tasks.\n" +
      "4. Consolidate fragmented memories periodically with consolidate_memories.\n";

    return prompt;
  }

  private createTransport(llm: AgentConfig["llm"]): Transport {
    if (llm.protocol === "anthropic") return new AnthropicTransport(llm);
    return new ChatCompletionsTransport(llm);
  }

  private get tools(): ToolDef[] | undefined {
    const list = this.toolRegistry.list();
    return list.length > 0 ? list : undefined;
  }

  async run(userInput: string): Promise<string> {
    this.messages.push({ role: "user", content: userInput });
    this.toolCallCount = 0;
    if (this.sessionDb) {
      this.sessionDb.saveMessage(this.sessionId, { role: "user", content: userInput });
    }
    const systemPrompt = this.buildSystemPrompt(userInput);

    let result = "";
    for (let turn = 0; turn < this.maxTurns; turn++) {
      const response = await this.callWithFallback(systemPrompt);
      if (!(await this.handleResponse(response))) {
        result = response.content;
        break;
      }
      result = response.content;
    }
    if (!result) result = "[max turns reached]";

    // Closed-loop learning: auto-suggest skill creation for complex tasks
    if (this.toolCallCount >= 5) {
      this.suggestSkillCreation(userInput, result);
    }

    return result;
  }

  async runStream(userInput: string, onToken: (token: string) => void): Promise<string> {
    this.messages.push({ role: "user", content: userInput });
    this.toolCallCount = 0;
    if (this.sessionDb) {
      this.sessionDb.saveMessage(this.sessionId, { role: "user", content: userInput });
    }
    const systemPrompt = this.buildSystemPrompt(userInput);

    let result = "";
    for (let turn = 0; turn < this.maxTurns; turn++) {
      const response = await this.streamWithFallback(systemPrompt, onToken);
      if (!(await this.handleResponse(response))) {
        result = response.content;
        break;
      }
      result = response.content;
    }
    if (!result) result = "[max turns reached]";

    if (this.toolCallCount >= 5) {
      this.suggestSkillCreation(userInput, result);
    }

    return result;
  }

  private async handleResponse(response: NormalizedResponse): Promise<boolean> {
    if (response.toolCalls && response.toolCalls.length > 0) {
      const assistantMsg: Message = {
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
      };
      this.messages.push(assistantMsg);
      if (this.sessionDb) this.sessionDb.saveMessage(this.sessionId, assistantMsg);

      for (const tc of response.toolCalls) {
        this.toolCallCount++;
        // Approval check before executing tool
        const approval = await this.approval.checkApproval(tc.name, tc.arguments);
        let result: unknown;
        if (!approval.approved) {
          result = `BLOCKED: ${approval.reason ?? "Operation requires approval"}`;
        } else {
          result = await this.toolRegistry.execute(tc.name, tc.arguments);
        }
        const toolMsg: Message = {
          role: "tool",
          content: typeof result === "string" ? result : JSON.stringify(result),
          toolCallId: tc.id,
        };
        this.messages.push(toolMsg);
        if (this.sessionDb) this.sessionDb.saveMessage(this.sessionId, toolMsg, tc.name);
      }
      return true; // continue loop
    }

    if (this.memory && response.content) {
      this.autoSaveMemory(response.content);
    }
    const finalMsg: Message = { role: "assistant", content: response.content };
    this.messages.push(finalMsg);
    if (this.sessionDb) this.sessionDb.saveMessage(this.sessionId, finalMsg);
    return false; // done
  }

  private autoSaveMemory(content: string): void {
    if (!this.memory) return;
    const keywords = [
      "vulnerability", "exploit", "offset", "address", "function",
      "漏洞", "偏移", "地址", "函数", "算法", "密钥", "加密",
      "key", "algorithm", "decrypt", "encrypt", "hash",
      "struct", "protocol", "format", "header",
    ];
    const lines = content.split("\n").filter((l) => l.trim().length > 10);
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (keywords.some((kw) => lower.includes(kw))) {
          this.memory.add(line.trim(), "finding", "auto");
        }
    }
  }

  /** Closed-loop learning: suggest creating a skill after complex tasks */
  private suggestSkillCreation(userInput: string, result: string): void {
    if (!this.memory) return;
    this.memory.add(
      `Complex task completed (${this.toolCallCount} tool calls). Consider using skill_manage create to save this workflow as a reusable skill. Task: ${userInput.slice(0, 100)}`,
      "lesson",
      "auto",
    );
  }

  private async callWithFallback(systemPrompt: string): Promise<NormalizedResponse> {
    let lastErr: unknown;
    try {
      return await this.transport.send(systemPrompt, this.messages, this.tools);
    } catch (err) {
      lastErr = err;
      if (this.fallbackTransport) {
        try { return await this.fallbackTransport.send(systemPrompt, this.messages, this.tools); } catch (err2) { lastErr = err2; }
      }
      throw new Error(`All providers failed: ${(lastErr as Error)?.message ?? lastErr}`);
    }
  }

  private async streamWithFallback(
    systemPrompt: string,
    onToken: (token: string) => void,
  ): Promise<NormalizedResponse> {
    let lastErr: unknown;
    try {
      return await this.transport.sendStream(systemPrompt, this.messages, onToken, this.tools);
    } catch (err) {
      lastErr = err;
      if (this.fallbackTransport) {
        try { return await this.fallbackTransport.sendStream(systemPrompt, this.messages, onToken, this.tools); } catch (err2) { lastErr = err2; }
      }
      throw new Error(`All providers failed: ${(lastErr as Error)?.message ?? lastErr}`);
    }
  }

  addTools(tools: ToolDef[]): void {
    for (const t of tools) this.toolRegistry.register(t);
  }

  setMcpClients(clients: unknown[]): void {
    this.mcpClients = clients;
  }

  getToolRegistry(): ToolRegistry { return this.toolRegistry; }
  getSkillRegistry(): SkillRegistry { return this.skillRegistry; }
  getMemory(): MemoryStore | null { return this.memory; }
  getUserProfile(): UserProfile | null { return this.userProfile; }
  getApprovalSystem(): ApprovalSystem { return this.approval; }

  getHistory(): Message[] { return [...this.messages]; }
  reset(): void { this.messages = []; }

  async close(): Promise<void> {
    if (this.memory) this.memory.close();
    // Close MCP clients
    for (const client of this.mcpClients) {
      if (client && typeof (client as { close?: () => void }).close === "function") {
        (client as { close: () => void }).close();
      }
    }
    this.mcpClients = [];
  }
}
