import type { AgentConfig, Message, NormalizedResponse, ToolCall, ToolDef } from "./types.js";
import type { McpServerConfig } from "./config/index.js";
import { createTransportFromConfig } from "./transports/factory.js";
import type { Transport } from "./transports/base.js";
import { ToolRegistry } from "./tools/registry.js";
import { ApprovalSystem } from "./tools/approval.js";
import { ToolCallGuardrail } from "./tools/guardrails.js";
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
import { PersonalityStore } from "./personality/index.js";
import { mcpManageTool } from "./mcp/tools.js";
import { toolsetManageTool } from "./tools/toolset.js";
import { setOnToolListChanged } from "./tools/mcp.js";
import { CredentialPool, buildCredentialPool } from "./credential-pool.js";
import type { PooledCredential } from "./credential-pool.js";
import { AuxiliaryClient, buildAuxiliaryClient } from "./auxiliary-client.js";
import { redactSensitiveText } from "./redact.js";
import { classifyError, jitteredBackoff } from "./errors/classifier.js";
import type { ClassifiedError } from "./errors/classifier.js";
import { ptcTool } from "./ptc.js";
import { moaTool } from "./moa.js";
import { resolveReferences } from "./context/references.js";
import { CheckpointManager } from "./checkpoint.js";
import { ttsTool, transcriptionTool } from "./tts.js";
import { KanbanBoard, kanbanTool } from "./kanban.js";
import { getModelMetadata, getContextWindow } from "./tools/model-metadata.js";
import { getModelGuidance } from "./model-prompts.js";
import { ContextCompressor } from "./context/compressor.js";
import { GoalManager } from "./goals/index.js";
import { HookRegistry } from "./hooks.js";
import { SkinManager } from "./skin.js";
import { SnapshotManager } from "./snapshot.js";
import { PluginSystem } from "./plugin-system.js";
import { InsightsEngine } from "./tools/insights.js";
import { BackgroundTaskManager } from "./bg-tasks.js";
import { postWriteLintHook } from "./tools/post-write-lint.js";
import { inlineDiffPreHook, inlineDiffPostHook } from "./tools/inline-diff.js";

export class Agent {
  private transport: Transport;
  private fallbackTransport: Transport | null;
  private credentialPool: CredentialPool | null;
  private auxiliaryClient: AuxiliaryClient;
  private checkpoint: CheckpointManager;
  private kanban: KanbanBoard;
  private compressor: ContextCompressor;
  private goalManager: GoalManager;
  /** Hook registry for pre/post tool calls, session events, errors (Task 3) */
  readonly hooks: HookRegistry;
  /** Skin/Theme manager (Task 6) */
  readonly skin: SkinManager;
  /** Snapshot manager (Task 8) */
  readonly snapshots: SnapshotManager;
  /** Plugin system (Tier 1) */
  readonly pluginSystem: PluginSystem;
  /** Background task manager (Tier 3) */
  readonly bgTasks: BackgroundTaskManager;
  /** Agent behavior config (Phase 2) */
  private timeoutMs: number;
  private apiMaxRetries: number;
  private retryBackoffMs: number;
  private toolUseEnforcement: "auto" | boolean;
  private notifyIntervalMs: number;
  /** Tool output limits (Phase 4) */
  private toolOutputMaxBytes: number;
  private toolOutputMaxLines: number;
  private toolOutputMaxLineLength: number;
  private fileReadMaxChars: number;
  /** Tool progress display mode (Task 5) */
  progressMode: "off" | "new" | "all" | "verbose";
  private lastToolName: string;
  /** Status bar display density */
  statusBarMode: "compact" | "normal" | "detailed";
  /** Voice mode configuration */
  voiceMode: "off" | "tts" | "stt" | "on";
  private sessionStarted = false;
  private ownsMemory: boolean;
  private messages: Message[] = [];
  private branches = new Map<string, { id: string; messages: Message[] }>();
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
  private mcpServerTools = new Map<string, { toolNames: string[]; client: unknown; config?: McpServerConfig }>();
  private sessionDb: SessionDB | null;
  private sessionId: string;
  private projectContext: ProjectContext;
  private workingMemory: WorkingMemory;
  private approval: ApprovalSystem;
  private guardrail: ToolCallGuardrail;
  private honcho: HonchoUserModel;
  private personality: PersonalityStore;
  private lastUsage: { promptTokens: number; completionTokens: number } = { promptTokens: 0, completionTokens: 0 };
  private totalUsage: { promptTokens: number; completionTokens: number; turns: number } = { promptTokens: 0, completionTokens: 0, turns: 0 };
  private compressionCount = 0;
  private steerMessage: string | null = null;
  private lastActivityAt = Date.now();
  private lastPressureWarned: "ok" | "moderate" | "high" | "critical" = "ok";
  private model: string;
  private contextWindow: number;
  private llmConfig: AgentConfig["llm"];

  // Tool progress callbacks (registered by CLI/TG for display)
  // Legacy signature: (name, args) / (name, preview)
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  onToolResult?: (name: string, preview: string) => void;
  // New structured signature: fires after tool completes with duration + error state
  onToolComplete?: (info: {
    name: string;
    args: Record<string, unknown>;
    duration: number;
    isError: boolean;
    resultPreview: string;
  }) => void;

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
    // Credential pool: multi-key failover (only if apiKeys array is provided)
    this.credentialPool = (config.llm.apiKeys && config.llm.apiKeys.length > 1)
      ? buildCredentialPool(config.llm)
      : null;
    // Auxiliary client: separate transport for summarization/vision/title
    // Phase 3: pass per-task auxiliary config for per-task model routing
    this.auxiliaryClient = buildAuxiliaryClient(config.llm, config.auxiliary);
    // Checkpoint manager for file operation snapshots
    this.checkpoint = new CheckpointManager();
    // Kanban board for multi-agent coordination
    this.kanban = new KanbanBoard();
    // Context compressor with configurable strategy
    this.compressor = new ContextCompressor(config.compression);
    // Goal manager for autonomous multi-turn work (Ralph Loop)
    this.goalManager = new GoalManager();
    // Hook registry for user-registered event handlers
    this.hooks = new HookRegistry();
    this.skin = new SkinManager();
    this.snapshots = new SnapshotManager();
    this.pluginSystem = new PluginSystem();
    this.bgTasks = new BackgroundTaskManager();
    // Agent behavior config (Phase 2)
    this.timeoutMs = config.behavior?.timeoutMs ?? 0;
    this.apiMaxRetries = config.behavior?.apiMaxRetries ?? 3;
    this.retryBackoffMs = config.behavior?.retryBackoffMs ?? 1000;
    this.toolUseEnforcement = config.behavior?.toolUseEnforcement ?? "auto";
    this.notifyIntervalMs = config.behavior?.notifyIntervalMs ?? 0;
    // Tool output limits (Phase 4)
    this.toolOutputMaxBytes = config.toolOutput?.maxBytes ?? 50_000;
    this.toolOutputMaxLines = config.toolOutput?.maxLines ?? 2000;
    this.toolOutputMaxLineLength = config.toolOutput?.maxLineLength ?? 2000;
    this.fileReadMaxChars = config.fileRead?.maxChars ?? 100_000;
    this.progressMode = "new";
    this.lastToolName = "";
    this.statusBarMode = "normal";
    this.voiceMode = "off";
    this.toolRegistry = new ToolRegistry(config.tools ?? []);
    // Inject registries so plugins can register tools/hooks (must be after toolRegistry init)
    this.pluginSystem.injectRegistries(this.toolRegistry, this.hooks);
    this.maxTurns = config.maxTurns ?? 20;
    this.basePrompt = config.systemPrompt ?? "You are Skeleton, a reverse engineering AI assistant.";
    this.model = config.llm.model;
    this.contextWindow = getContextWindow(config.llm.model);
    this.llmConfig = config.llm;
    this.memory = memory ?? null;
    this.ownsMemory = !memory;
    this.userProfile = userProfile ?? null;
    this.sessionDb = sessionDb ?? null;
    this.sessionId = `sess_${Date.now().toString(36)}`;
    this.projectContext = projectContext ?? new ProjectContext();
    this.workingMemory = new WorkingMemory();
    this.approval = new ApprovalSystem();
    this.guardrail = new ToolCallGuardrail();
    this.honcho = honcho ?? new HonchoUserModel();
    this.personality = new PersonalityStore();

    // Register Honcho dialectical tools
    for (const tool of honchoTools(this.honcho)) {
      (tool as { toolset?: string; emoji?: string }).toolset = "honcho";
      (tool as { emoji?: string }).emoji = "🧠";
      this.toolRegistry.register(tool);
    }

    // Register working memory tools
    for (const tool of workingMemoryTools(this.workingMemory)) {
      (tool as { toolset?: string; emoji?: string }).toolset = "memory";
      (tool as { emoji?: string }).emoji = "💭";
      this.toolRegistry.register(tool);
    }

    // Freeze snapshots at session start for prefix cache consistency
    this.frozenMemorySnapshot = this.memory ? this.memory.freezeSnapshot() : "";
    this.frozenUserSnapshot = this.userProfile ? this.userProfile.freezeSnapshot() : "";

    // Register memory tools so the LLM can save/search memories
    if (this.memory && this.userProfile) {
      const memEmojiMap: Record<string, string> = {
        save_memory: "💾", search_memory: "🔎", get_user_profile: "👤", consolidate_memories: "🧹",
      };
      for (const tool of memoryTools(this.memory, this.userProfile)) {
        (tool as { toolset?: string; emoji?: string }).toolset = "memory";
        (tool as { emoji?: string }).emoji = memEmojiMap[tool.name] ?? "🧠";
        this.toolRegistry.register(tool);
      }
    }

    // Skill registry — register all skill groups + load agent-created from disk
    this.skillRegistry = new SkillRegistry();
    const skillConfig = config.skills ?? { ctf: true };
    // Progressive disclosure (Hermes pattern): inject only name + description catalog
    // by default; LLM calls skill_view(name) to pull full content on demand.
    // Set ctf: "all" to eagerly inject full content (legacy, token-heavy).
    this.skillMode = skillConfig.ctf === "all" ? "all" : "catalog";

    if (skillConfig.ctf !== false) {
      registerCtfSkills(this.skillRegistry);
    }
    // Load user-created skills from disk
    this.skillRegistry.loadFromDisk();
    // Register skill_manage tool so LLM can create/edit/delete skills
    const skillMgmt = skillManageTool(this.skillRegistry);
    (skillMgmt as { toolset?: string; emoji?: string }).toolset = "skills";
    (skillMgmt as { emoji?: string }).emoji = "🛠️";
    this.toolRegistry.register(skillMgmt);
    // Register Tier 2+3 progressive disclosure tools (agentskills.io)
    const skillView = skillViewTool(this.skillRegistry);
    (skillView as { toolset?: string; emoji?: string }).toolset = "skills";
    (skillView as { emoji?: string }).emoji = "👁️";
    this.toolRegistry.register(skillView);
    const skillRes = skillResourceTool(this.skillRegistry);
    (skillRes as { toolset?: string; emoji?: string }).toolset = "skills";
    (skillRes as { emoji?: string }).emoji = "📎";
    this.toolRegistry.register(skillRes);

    // Register cron_manage tool if store provided
    if (cronStore) {
      const cronTool = cronManageTool(cronStore);
      (cronTool as { toolset?: string; emoji?: string }).toolset = "cron";
      (cronTool as { emoji?: string }).emoji = "⏰";
      this.toolRegistry.register(cronTool);
    }

    // Register delegate_task tool for sub-agent spawning
    const delegateTool = delegateTaskTool(config, () => this.toolRegistry.list());
    (delegateTool as { emoji?: string }).emoji = "🤝";
    this.toolRegistry.register(delegateTool);

    // Register mcp_manage tool for runtime MCP server management
    const mcpTool = mcpManageTool(this);
    (mcpTool as { toolset?: string; emoji?: string }).toolset = "mcp";
    (mcpTool as { emoji?: string }).emoji = "🔌";
    this.toolRegistry.register(mcpTool);
    // Register toolset_manage tool for toolset group management
    const tsTool = toolsetManageTool(this.toolRegistry);
    (tsTool as { emoji?: string }).emoji = "📦";
    this.toolRegistry.register(tsTool);

    // Register PTC (Programmatic Tool Calling) tool
    const ptc = ptcTool(this.toolRegistry);
    this.toolRegistry.register(ptc);

    // Register MoA (Mixture of Agents) tool
    const moa = moaTool(config);
    this.toolRegistry.register(moa);

    // Register TTS and transcription tools
    const tts = ttsTool();
    (tts as { toolset?: string }).toolset = "media";
    this.toolRegistry.register(tts);
    const stt = transcriptionTool();
    (stt as { toolset?: string }).toolset = "media";
    this.toolRegistry.register(stt);

    // Register Kanban tool for multi-agent coordination
    const kb = kanbanTool(this.kanban);
    this.toolRegistry.register(kb);

    // Register session search tools if SessionDB provided
    if (this.sessionDb) {
      this.sessionDb.createSession(this.sessionId);
      this.toolRegistry.register(sessionSearchTool(this.sessionDb));
      this.toolRegistry.register(recentSessionsTool(this.sessionDb));
    }

    // MCP dynamic tool discovery: refresh tools on tools/list_changed notification
    setOnToolListChanged((serverName: string) => {
      this.refreshMcpServerTools(serverName).catch(err => {
        console.error(`Failed to refresh MCP tools for "${serverName}": ${(err as Error).message}`);
      });
    });

    // Post-write lint hook: auto-lint files after write_file/patch/edit
    this.hooks.register("post_tool_call", async (ctx) => postWriteLintHook(ctx), "builtin:post-write-lint");
    // Inline diff hooks: snapshot before write, render diff after
    this.hooks.register("pre_tool_call", async (ctx) => inlineDiffPreHook(ctx), "builtin:inline-diff-pre");
    this.hooks.register("post_tool_call", async (ctx) => inlineDiffPostHook(ctx), "builtin:inline-diff-post");
  }

  private buildSystemPrompt(userQuery?: string): string {
    let prompt = this.basePrompt;

    // Inject personality (SOUL.md) at the top if configured
    const soulContent = this.personality.getActive();
    if (soulContent) {
      prompt = soulContent + "\n\n" + prompt;
    }

    // Model-specific guidance (GPT / Codex / Gemini / Gemma / Qwen / DeepSeek / GLM / Kimi / Llama / Mistral)
    const modelGuidance = getModelGuidance(this.model);
    if (modelGuidance) {
      prompt += "\n\n" + modelGuidance;
    }

    if (this.skillRegistry.list().length > 0) {
      if (this.skillMode === "all") {
        prompt += "\n\n## Skills (mandatory)\nIf a skill matches or is even partially relevant to your task, you MUST apply its workflow and techniques.\n";
        prompt += this.skillRegistry.loadAll();
      } else {
        prompt += "\n\n## Skills (mandatory)\n" +
          "Before replying, scan the skill catalog below. If any skill matches or is even " +
          "partially relevant to the user's request, you MUST call `skill_view(name)` to load " +
          "its full instructions and follow them. Err on the side of loading — it is always " +
          "better to have context you don't need than to miss critical steps, tool commands, " +
          "or workflows that the skill encodes.\n" +
          "Skills contain specialized knowledge (API calls, exploit techniques, analysis " +
          "pipelines, user conventions) that outperform generic approaches. Do not rely on " +
          "your training data for skill contents — the catalog only lists names and " +
          "descriptions; the actual instructions live behind `skill_view`.\n" +
          "If a skill is missing or wrong, fix it with `skill_manage(action='patch')`. " +
          "After difficult tasks, offer to save your approach as a new skill with " +
          "`skill_manage(action='create')`.\n\n" +
          "<available_skills>\n" +
          this.skillRegistry.buildCatalog() +
          "\n</available_skills>\n\n" +
          "Only proceed without loading a skill when genuinely none are relevant.\n";
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

    // Slash commands for user-invocable skills
    const invocableSkills = this.skillRegistry.list().filter(s => s.userInvocable);
    if (invocableSkills.length > 0) {
      prompt += "\n\n## Slash Commands\n" +
        "Users can invoke skills directly with /skill-name. Available:\n" +
        invocableSkills.map(s => `- /${s.name}: ${s.description}`).join("\n") + "\n" +
        "When a /command is detected, load and apply that skill's workflow immediately.\n";
    }

    return prompt;
  }

  private createTransport(llm: AgentConfig["llm"]): Transport {
    return createTransportFromConfig(llm);
  }

  /** Switch model at runtime — rebuilds transport with new model */
  switchModel(newModel: string): void {
    this.model = newModel;
    this.contextWindow = getContextWindow(newModel);
    this.llmConfig = { ...this.llmConfig, model: newModel };
    this.transport = this.createTransport(this.llmConfig);
  }

  private get tools(): ToolDef[] | undefined {
    const list = this.toolRegistry.list();
    return list.length > 0 ? list : undefined;
  }

  async run(userInput: string): Promise<string> {
    // Inactivity-based timeout: only kill if no tool/LLM activity for timeoutMs
    if (this.timeoutMs > 0) {
      this.lastActivityAt = Date.now();
      return await this.withInactivityTimeout(() => this._run(userInput));
    }
    return await this._run(userInput);
  }

  /** Record activity — resets inactivity timer */
  private recordActivity(): void {
    this.lastActivityAt = Date.now();
  }

  /** Run fn with inactivity-based timeout (polls every 10s) */
  private async withInactivityTimeout<T>(fn: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    let rejected = false;
    const timeoutPromise = new Promise<never>((_, reject) => {
      const check = () => {
        if (rejected) return;
        const idle = Date.now() - this.lastActivityAt;
        if (idle >= this.timeoutMs) {
          rejected = true;
          reject(new Error(`Agent inactivity timeout: no activity for ${Math.round(idle / 1000)}s (limit: ${Math.round(this.timeoutMs / 1000)}s)`));
          return;
        }
        timer = setTimeout(check, Math.min(10_000, this.timeoutMs - idle + 100));
      };
      timer = setTimeout(check, Math.min(10_000, this.timeoutMs));
    });

    try {
      return await Promise.race([fn(), timeoutPromise]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async _run(userInput: string): Promise<string> {
    // ── Hook: on_session_start (fire once, not on goal loop re-entry) ──
    if (!this.sessionStarted) {
      this.sessionStarted = true;
      await this.hooks.emit("on_session_start");
    }

    // Resolve context references (@file:, @url:, @git:, @diff:)
    let resolvedInput = userInput;
    if (/@(file|url|git|diff):/.test(userInput)) {
      try {
        const { resolvedMessage } = await resolveReferences(userInput);
        resolvedInput = resolvedMessage;
      } catch (err) {
        console.warn(`Context reference resolution failed: ${(err as Error).message}`);
      }
    }

    // Slash command: /skill-name → inject skill content as prompt
    const slashMatch = userInput.match(/^\/([a-z0-9_-]+)(?:\s+(.*))?$/);
    if (slashMatch) {
      const skillName = slashMatch[1];
      const skillArgs = slashMatch[2] ?? "";
      const skill = this.skillRegistry.get(skillName);
      if (skill && skill.userInvocable) {
        const skillContent = skill.content();
        const enhancedInput = skillArgs
          ? `[Skill: ${skillName} activated]\n${skillContent}\n\nUser input: ${skillArgs}`
          : `[Skill: ${skillName} activated]\n${skillContent}`;
        this.messages.push({ role: "user", content: enhancedInput });
        this.toolCallCount = 0;
        if (this.sessionDb) {
          this.sessionDb.saveMessage(this.sessionId, { role: "user", content: resolvedInput });
        }
        const systemPrompt = this.buildSystemPrompt(enhancedInput);
        let result = "";
        for (let turn = 0; turn < this.maxTurns; turn++) {
          const response = await this.callWithFallback(systemPrompt);
          if (!(await this.handleResponse(response))) {
            result = response.content ?? "";
            break;
          }
          result = response.content ?? "";
        }
        if (this.toolCallCount >= 5) {
          this.suggestSkillCreation(resolvedInput, result);
        }
        return result;
      }
    }

    // Auto-compress when context usage exceeds threshold
    if (this.compressor.shouldCompress(this.messages, this.contextWindow)) {
      console.log(`Auto-compressing ${this.messages.length} messages (context usage exceeded threshold)`);
      await this.compress();
    }

    this.messages.push({ role: "user", content: resolvedInput });
    this.toolCallCount = 0;
    if (this.sessionDb) {
      this.sessionDb.saveMessage(this.sessionId, { role: "user", content: resolvedInput });
    }
    const systemPrompt = this.buildSystemPrompt(resolvedInput);

    let result = "";
    for (let turn = 0; turn < this.maxTurns; turn++) {
      // Mid-turn compression check: tool output can bloat context past the limit
      if (turn > 0 && this.compressor.shouldCompress(this.messages, this.contextWindow)) {
        console.log(`Mid-turn auto-compress at turn ${turn} (${this.messages.length} messages)`);
        await this.compress();
      }
      const response = await this.callWithFallback(systemPrompt);
      if (!(await this.handleResponse(response))) {
        result = response.content ?? "";
        break;
      }
      result = response.content ?? "";
    }
    if (!result) result = "[max turns reached]";

    // Closed-loop learning: auto-suggest skill creation for complex tasks
    if (this.toolCallCount >= 5) {
      this.suggestSkillCreation(resolvedInput, result);
    }

    // ── Goal Loop (Ralph Loop) — autonomous multi-turn continuation ──
    // If this session has an active goal, judge whether it's done.
    // If not, auto-feed a continuation prompt back into run().
    result = await this.maybeRunGoalLoop(result);

    // ── Hook: on_session_end ──
    await this.hooks.emit("on_session_end");

    return result;
  }

  /**
   * Goal loop: after each run, check if the active goal is satisfied.
   * If not, auto-inject a continuation prompt and recurse.
   *
   * Exits when: goal done, turn budget exhausted, user message preempts,
   * or judge hits too many parse failures.
   */
  private async maybeRunGoalLoop(lastResult: string): Promise<string> {
    if (!this.goalManager.hasActiveGoal(this.sessionId)) {
      return lastResult;
    }

    const goal = this.goalManager.getGoal(this.sessionId);
    if (!goal) return lastResult;

    // Increment turn counter
    this.goalManager.incrementTurns(this.sessionId);

    // Check if budget exhausted after increment
    const updatedGoal = this.goalManager.getGoal(this.sessionId);
    if (!updatedGoal || updatedGoal.status !== "active") {
      return lastResult;
    }

    // Judge whether the goal is satisfied
    try {
      const verdict = await this.auxiliaryClient.judgeGoal(goal.goal, lastResult);
      this.goalManager.recordVerdict(
        this.sessionId,
        verdict.done ? "done" : "continue",
        verdict.reason,
      );

      if (verdict.done) {
        return `${lastResult}\n\n[Goal complete: ${verdict.reason}]`;
      }

      // Continue: inject continuation prompt back into run()
      const continuation = this.goalManager.buildContinuationPrompt(this.sessionId);
      if (continuation && updatedGoal.status === "active") {
        console.log(`[Goal loop] Continuing (turn ${updatedGoal.turnsUsed}/${updatedGoal.maxTurns})`);
        return await this.run(continuation);
      }
    } catch (err) {
      this.goalManager.recordVerdict(this.sessionId, "skipped", `judge error: ${(err as Error).message}`);
    }

    return lastResult;
  }

  /** Public API: set or update the goal for this session */
  setGoal(goal: string, maxTurns?: number): void {
    this.goalManager.setGoal(this.sessionId, goal, maxTurns);
  }

  /** Public API: get the current goal state */
  getGoal() {
    return this.goalManager.getGoal(this.sessionId);
  }

  /** Public API: pause the goal loop */
  pauseGoal(reason?: string): void {
    this.goalManager.pauseGoal(this.sessionId, reason);
  }

  /** Public API: resume a paused goal */
  resumeGoal(): boolean {
    return this.goalManager.resumeGoal(this.sessionId);
  }

  /** Public API: clear the goal entirely */
  clearGoal(): void {
    this.goalManager.clearGoal(this.sessionId);
  }

  async runStream(userInput: string, onToken: (token: string) => void): Promise<string> {
    // Pre-turn compression check (same as _run)
    if (this.compressor.shouldCompress(this.messages, this.contextWindow)) {
      console.log(`Auto-compressing ${this.messages.length} messages before stream turn`);
      await this.compress();
    }

    this.messages.push({ role: "user", content: userInput });
    this.toolCallCount = 0;
    if (this.sessionDb) {
      this.sessionDb.saveMessage(this.sessionId, { role: "user", content: userInput });
    }
    const systemPrompt = this.buildSystemPrompt(userInput);

    let result = "";
    for (let turn = 0; turn < this.maxTurns; turn++) {
      // Mid-turn compression check for streaming too
      if (turn > 0 && this.compressor.shouldCompress(this.messages, this.contextWindow)) {
        console.log(`Mid-turn auto-compress at stream turn ${turn} (${this.messages.length} messages)`);
        await this.compress();
      }
      const response = await this.streamWithFallback(systemPrompt, onToken);
      if (!(await this.handleResponse(response))) {
        result = response.content ?? "";
        break;
      }
      result = response.content ?? "";
    }
    if (!result) result = "[max turns reached]";

    if (this.toolCallCount >= 5) {
      this.suggestSkillCreation(userInput, result);
    }

    return result;
  }

  private async handleResponse(response: NormalizedResponse): Promise<boolean> {
    if (response.usage) {
      this.updateUsage(response.usage.promptTokens, response.usage.completionTokens);
    }

    // ── Thinking-budget exhaustion detection ──
    // Some reasoning models (Claude thinking, o-series, Gemini thinking) can burn
    // their entire output budget on internal reasoning and return an empty visible
    // response. Detect that here so we don't silently loop on blank assistant turns.
    const hasToolCalls = !!(response.toolCalls && response.toolCalls.length > 0);
    const visibleContent = (response.content ?? "").trim();
    const finishReason = (response.finishReason ?? "").toLowerCase();
    const budgetExhaustedReasons = new Set([
      "length", "max_tokens", "max_output_tokens", "truncated", "incomplete",
    ]);
    if (!hasToolCalls && !visibleContent && budgetExhaustedReasons.has(finishReason)) {
      const diagnostic =
        `[⚠ thinking budget exhausted — model returned empty content (finish_reason=${response.finishReason}). ` +
        `Try lowering reasoning effort, raising max_tokens, or switching model.]`;
      const finalMsg: Message = { role: "assistant", content: diagnostic };
      this.messages.push(finalMsg);
      if (this.sessionDb) this.sessionDb.saveMessage(this.sessionId, finalMsg);
      (response as { content: string }).content = diagnostic;
      return false;
    }

    if (response.toolCalls && response.toolCalls.length > 0) {
      const assistantMsg: Message = {
        role: "assistant",
        content: response.content ?? "",
        toolCalls: response.toolCalls,
      };
      this.messages.push(assistantMsg);
      if (this.sessionDb) this.sessionDb.saveMessage(this.sessionId, assistantMsg);

      // Classify tool calls for parallel execution
      const { parallel, serial } = this.classifyToolCalls(response.toolCalls);

      // Execute parallel-safe tools concurrently
      if (parallel.length > 0) {
        const results = await Promise.all(
          parallel.map(async (tc) => this.executeToolCall(tc)),
        );
        for (const { tc, resultStr } of results) {
          this.onToolResult?.(tc.name, resultStr);
          const toolMsg: Message = { role: "tool", content: resultStr, toolCallId: tc.id };
          this.messages.push(toolMsg);
          if (this.sessionDb) this.sessionDb.saveMessage(this.sessionId, toolMsg, tc.name);
        }
      }

      // Execute serial tools sequentially
      for (const tc of serial) {
        const { resultStr } = await this.executeToolCall(tc);
        this.onToolResult?.(tc.name, resultStr);
        const toolMsg: Message = { role: "tool", content: resultStr, toolCallId: tc.id };
        this.messages.push(toolMsg);
        if (this.sessionDb) this.sessionDb.saveMessage(this.sessionId, toolMsg, tc.name);
      }

      // Inject queued steer message (if any) as a user note the agent sees on next turn
      if (this.steerMessage) {
        const steerMsg: Message = {
          role: "user",
          content: `[STEER — mid-run guidance from user]\n${this.steerMessage}`,
        };
        this.messages.push(steerMsg);
        if (this.sessionDb) this.sessionDb.saveMessage(this.sessionId, steerMsg);
        this.steerMessage = null;
      }

      return true; // continue loop
    }

    // ── Hook: transform_llm_output (allows plugins to reshape content before storage) ──
    let finalContent = response.content ?? "";
    const transformResult = await this.hooks.emit("transform_llm_output", { result: finalContent });
    if (transformResult.transformedContent !== undefined) {
      finalContent = transformResult.transformedContent;
    }

    if (this.memory && finalContent) {
      this.autoSaveMemory(finalContent);
    }
    const finalMsg: Message = { role: "assistant", content: finalContent };
    this.messages.push(finalMsg);
    if (this.sessionDb) this.sessionDb.saveMessage(this.sessionId, finalMsg);
    return false; // done
  }

  // ─── Tool parallelization ────────────────────────────────────────────────

  private static NEVER_PARALLEL = new Set([
    "terminal", "browser", "write_file", "remove_file",
    "skill_manage", "cron_manage", "mcp_manage", "delegate_task",
  ]);

  private static PARALLEL_SAFE = new Set([
    "identify", "hexdump", "strings", "entropy", "pe_info", "elf_info",
    "web_search", "web_fetch", "search_memory", "session_search",
    "recent_sessions", "skill_view", "skill_resource",
  ]);

  /** PATH_SCOPED tools: parallel if paths don't overlap */
  private static PATH_SCOPED_TOOLS = new Set(["read_file", "search_files"]);

  private classifyToolCalls(toolCalls: ToolCall[]): {
    parallel: ToolCall[];
    serial: ToolCall[];
  } {
    const parallel: ToolCall[] = [];
    const serial: ToolCall[] = [];

    for (const tc of toolCalls) {
      // Never-parallel tools always go serial
      if (Agent.NEVER_PARALLEL.has(tc.name)) {
        serial.push(tc);
        continue;
      }

      // Parallel-safe tools go parallel
      if (Agent.PARALLEL_SAFE.has(tc.name)) {
        parallel.push(tc);
        continue;
      }

      // Path-scoped tools: check for path overlap
      if (Agent.PATH_SCOPED_TOOLS.has(tc.name)) {
        const thisPath = String(tc.arguments.path ?? tc.arguments.file ?? tc.arguments.directory ?? "");
        const overlap = parallel.some(
          (p) => Agent.PATH_SCOPED_TOOLS.has(p.name) &&
            String(p.arguments.path ?? p.arguments.file ?? p.arguments.directory ?? "").startsWith(thisPath),
        );
        if (overlap) {
          serial.push(tc);
        } else {
          parallel.push(tc);
        }
        continue;
      }

      // MCP tools: parallel if different servers
      if (serial.length === 0 && !Agent.NEVER_PARALLEL.has(tc.name)) {
        parallel.push(tc);
      } else {
        serial.push(tc);
      }
    }

    return { parallel, serial };
  }

  private async executeToolCall(tc: ToolCall): Promise<{ tc: ToolCall; resultStr: string; duration: number; isError: boolean }> {
    const startTime = Date.now();
    this.toolCallCount++;
    this.recordActivity();
    this.onToolCall?.(tc.name, tc.arguments);

    // Notify project context of directory visits (progressive subdirectory discovery)
    if (tc.name === "terminal" && tc.arguments.cwd) {
      this.projectContext.notifyDirectoryVisit(String(tc.arguments.cwd));
    }

    // ── Hook: pre_tool_call (allows blocking or arg modification) ──
    const preResult = await this.hooks.emit("pre_tool_call", {
      toolName: tc.name,
      args: tc.arguments as Record<string, unknown>,
    });
    if (preResult.blocked) {
      const duration = (Date.now() - startTime) / 1000;
      const blockedStr = `BLOCKED_BY_HOOK: ${preResult.reason ?? "pre_tool_call hook blocked execution"}`;
      this.onToolComplete?.({ name: tc.name, args: tc.arguments, duration, isError: true, resultPreview: blockedStr.slice(0, 200) });
      return { tc, resultStr: blockedStr, duration, isError: true };
    }
    // Apply arg modifications from hooks
    if (preResult.modifiedArgs) {
      tc = { ...tc, arguments: { ...tc.arguments, ...preResult.modifiedArgs } };
    }

    // Guardrail check
    const guardCheck = this.guardrail.check(tc.name, tc.arguments);
    let result: unknown;
    let isError = false;

    if (!guardCheck.allow) {
      result = `GUARDRAIL: ${guardCheck.reason}`;
      this.guardrail.record(tc.name, tc.arguments, "blocked");
      isError = true;
    } else {
      const approval = await this.approval.checkApproval(tc.name, tc.arguments);
      if (!approval.approved) {
        result = `BLOCKED: ${approval.reason ?? "Operation requires approval"}`;
        this.guardrail.record(tc.name, tc.arguments, "blocked");
        isError = true;
      } else {
        try {
          result = await this.toolRegistry.execute(tc.name, tc.arguments);
          const r = typeof result === "string" ? result : (JSON.stringify(result) ?? String(result));
          const resultIsError = r.startsWith("error") || r.includes('"error"');
          this.guardrail.record(tc.name, tc.arguments, resultIsError ? "error" : "success");
          if (resultIsError) isError = true;
        } catch (err) {
          result = `Error: ${(err as Error).message}`;
          this.guardrail.record(tc.name, tc.arguments, "error");
          isError = true;
          // ── Hook: on_error (tool execution failure) ──
          await this.hooks.emit("on_error", {
            toolName: tc.name,
            args: tc.arguments as Record<string, unknown>,
            error: err as Error,
          });
        }
      }
    }

    const warnings = this.guardrail.drainWarnings();
    let resultStr = typeof result === "string" ? result : (JSON.stringify(result) ?? String(result));
    // Redact secrets from tool output before it enters conversation context
    resultStr = redactSensitiveText(resultStr, { force: true });
    // Apply tool output limits (Phase 4)
    resultStr = this.applyToolOutputLimits(tc.name, resultStr);

    // Apply plugin tool-result transformers (can rewrite output)
    resultStr = await this.pluginSystem.applyToolResultTransformers(tc.name, tc.arguments, resultStr);

    // Apply plugin terminal-output transformers for terminal tool specifically
    if (tc.name === "terminal" || tc.name === "bash" || tc.name === "execute_code") {
      resultStr = await this.pluginSystem.applyTerminalTransformers(resultStr);
    }

    const finalResultStr = warnings.length > 0
      ? `${resultStr}\n[GUARDRAIL WARNING: ${warnings.join("; ")}]`
      : resultStr;

    const duration = (Date.now() - startTime) / 1000;

    // Fire new structured completion callback
    this.onToolComplete?.({
      name: tc.name,
      args: tc.arguments,
      duration,
      isError,
      resultPreview: finalResultStr.slice(0, 200),
    });

    // ── Hook: post_tool_call (allows context injection, logging) ──
    await this.hooks.emit("post_tool_call", {
      toolName: tc.name,
      args: tc.arguments as Record<string, unknown>,
      result: finalResultStr.slice(0, 500),
      durationMs: duration * 1000,
    });

    return { tc, resultStr: finalResultStr, duration, isError };
  }

  /**
   * Apply tool output size limits (Phase 4): prevent super-large outputs
   * from eating the context window.
   *
   * - terminal/bash: truncate to maxBytes (keep head + tail)
   * - read_file: cap at fileReadMaxChars (user should paginate)
   * - all tools: enforce maxLineLength per line
   */
  private applyToolOutputLimits(toolName: string, output: string): string {
    if (!output) return output;

    // Per-tool caps
    let maxBytes: number;
    if (toolName === "terminal" || toolName === "bash" || toolName === "execute_code") {
      maxBytes = this.toolOutputMaxBytes;
    } else if (toolName === "read_file") {
      maxBytes = this.fileReadMaxChars;
    } else {
      // Default cap for all other tools (match terminal cap)
      maxBytes = this.toolOutputMaxBytes;
    }

    // Byte cap (head + tail)
    if (output.length > maxBytes) {
      const head = Math.floor(maxBytes * 0.6);
      const tail = Math.floor(maxBytes * 0.4);
      const truncated = output.length - head - tail;
      output = `${output.slice(0, head)}\n\n[... ${truncated} chars truncated (cap: ${maxBytes}). Use pagination/offset to see more ...]\n\n${output.slice(-tail)}`;
    }

    // Line length cap
    if (this.toolOutputMaxLineLength > 0) {
      const lines = output.split("\n");
      let anyTruncated = false;
      const capped = lines.map((line) => {
        if (line.length > this.toolOutputMaxLineLength) {
          anyTruncated = true;
          return line.slice(0, this.toolOutputMaxLineLength) + `... [line truncated: ${line.length - this.toolOutputMaxLineLength} chars]`;
        }
        return line;
      });
      if (anyTruncated) output = capped.join("\n");
    }

    // Line count cap
    if (this.toolOutputMaxLines > 0) {
      const lines = output.split("\n");
      if (lines.length > this.toolOutputMaxLines) {
        const headLines = Math.floor(this.toolOutputMaxLines * 0.6);
        const tailLines = Math.floor(this.toolOutputMaxLines * 0.4);
        const dropped = lines.length - headLines - tailLines;
        output = [
          ...lines.slice(0, headLines),
          `\n[... ${dropped} lines truncated (cap: ${this.toolOutputMaxLines}) ...]\n`,
          ...lines.slice(-tailLines),
        ].join("\n");
      }
    }

    return output;
  }

  private autoSaveMemory(content: string): void {
    if (!this.memory) return;
    const keywords = [
      "vulnerability", "exploit", "offset", "address", "function",
      "漏洞", "偏移", "地址", "函数", "算法", "密钥", "加密",
      "key", "algorithm", "decrypt", "encrypt", "hash",
      "struct", "protocol", "format", "header",
    ];
    const negations = [
      "not vulnerable", "no vulnerability", "isn't vulnerable", "no exploit",
      "no exploit found", "not an exploit", "not exploitable", "no offset",
      "no address", "no key found", "no hash found", "no function",
      "not a function", "no protocol", "no header", "no struct",
      "不存在", "没有漏洞", "未发现", "无偏移", "无地址", "无密钥",
    ];
    const lines = content.split("\n").filter((l) => l.trim().length > 10);
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (keywords.some((kw) => lower.includes(kw))) {
        if (negations.some((neg) => lower.includes(neg))) continue;
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
    this.recordActivity();
    // ── Hook: pre_llm_call (allows context injection before LLM call) ──
    const preResult = await this.hooks.emit("pre_llm_call");
    let prompt = systemPrompt;
    if (preResult.contextInjection) {
      prompt += "\n" + preResult.contextInjection;
    }

    const response = await this.retryWithFallback(
      () => this.transport.send(prompt, this.messages, this.tools),
      () => this.fallbackTransport?.send(prompt, this.messages, this.tools),
      this.apiMaxRetries,
    );

    // ── Hook: post_llm_call ──
    await this.hooks.emit("post_llm_call", { result: response });

    return response;
  }

  private async streamWithFallback(
    systemPrompt: string,
    onToken: (token: string) => void,
  ): Promise<NormalizedResponse> {
    this.recordActivity();
    // Wrap onToken to record activity on each chunk (so long streams don't time out)
    const tokenWithActivity = (token: string) => {
      this.recordActivity();
      onToken(token);
    };
    // ── Hook: pre_llm_call (streaming path) ──
    const preResult = await this.hooks.emit("pre_llm_call");
    let prompt = systemPrompt;
    if (preResult.contextInjection) {
      prompt += "\n" + preResult.contextInjection;
    }

    const response = await this.retryWithFallback(
      () => this.transport.sendStream(prompt, this.messages, tokenWithActivity, this.tools),
      () => this.fallbackTransport?.sendStream(prompt, this.messages, tokenWithActivity, this.tools),
      this.apiMaxRetries,
    );

    // ── Hook: post_llm_call (streaming path) ──
    await this.hooks.emit("post_llm_call", { result: response });

    return response;
  }

  private async retryWithFallback(
    primary: () => Promise<NormalizedResponse>,
    fallback: () => Promise<NormalizedResponse> | undefined,
    maxRetries = 3,
  ): Promise<NormalizedResponse> {
    let lastClassified: ClassifiedError | null = null;
    let lastErr: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await primary();
      } catch (err) {
        lastErr = err;
        lastClassified = classifyError(err);
        const { category, action, retryable } = lastClassified;

        // Rotate credential on auth/rate-limit errors
        if ((action === "rotate_credential") && this.credentialPool) {
          const statusCode = lastClassified.statusCode ?? (category.startsWith("auth") ? 401 : 429);
          const next = this.credentialPool.markExhaustedAndRotate(statusCode);
          if (next) {
            const currentConfig = this.transport.getConfig?.();
            if (currentConfig) {
              this.transport = this.createTransport({
                ...currentConfig,
                apiKey: next.apiKey,
                baseUrl: next.baseUrl ?? currentConfig.baseUrl,
              });
            }
            console.log(`Credential pool: rotated to "${next.label}" [${category}]`);
            continue;
          }
        }

        // Compress context if too large
        if (action === "compress_context" && this.messages.length > 10) {
          console.warn(`Context error [${category}], compressing before retry`);
          await this.compress();
          continue;
        }

        // Retry with jittered backoff
        if (retryable && attempt < maxRetries - 1) {
          const delay = jitteredBackoff(attempt);
          console.warn(`Error [${category}], retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        // Abort: non-retryable or exhausted retries
        if (action === "abort") {
          throw new Error(`[${category}] ${(err as Error).message}`);
        }
        break; // → try fallback
      }
    }

    // Fallback transport
    if (lastClassified?.action === "fallback_provider" || !lastClassified?.retryable) {
      const fallbackFn = fallback();
      if (fallbackFn) {
        try { return await fallbackFn; } catch (err2) { lastErr = err2; }
      }
    }
    throw new Error(`All providers failed [${lastClassified?.category ?? "unknown"}]: ${(lastErr as Error)?.message ?? lastErr}`);
  }

  addTools(tools: ToolDef[]): void {
    for (const t of tools) this.toolRegistry.register(t);
  }

  async addMcpServer(name: string, config: McpServerConfig): Promise<{ added: string[]; warnings?: string[] }> {
    if (this.mcpServerTools.has(name)) {
      await this.removeMcpServer(name);
    }

    const { connectMcpServer } = await import("./tools/mcp.js");
    const { tools, client } = await connectMcpServer(name, config);

    // Scan MCP tool descriptions for injection patterns
    const { scanMcpToolList } = await import("./tools/security.js");
    const { safe, warnings } = scanMcpToolList(tools.map(t => ({ name: t.name, description: t.description })));
    // Replace descriptions on flagged tools with sanitized versions
    for (const t of tools) {
      const safeEntry = safe.find(s => s.name === t.name);
      if (safeEntry && safeEntry.description !== t.description) {
        (t as { description: string }).description = safeEntry.description;
      }
    }

    const toolNames: string[] = [];

    const existing = new Set(this.toolRegistry.list().map(t => t.name));
    for (const t of tools) {
      const prefixedName = `mcp_${name}_${t.name}`;
      if (existing.has(prefixedName)) {
        console.warn(`MCP tool "${prefixedName}" from server "${name}" collides with existing tool — skipping`);
        continue;
      }
      (t as { name: string }).name = prefixedName;
      if (!t.description.includes(t.name)) {
        (t as { description: string }).description = `[${name}] ${t.description}`;
      }
      this.toolRegistry.register(t);
      toolNames.push(prefixedName);
    }

    this.mcpClients.push(client);
    this.mcpServerTools.set(name, { toolNames, client, config });
    return { added: toolNames, warnings: warnings.length > 0 ? warnings : undefined };
  }

  async removeMcpServer(name: string): Promise<boolean> {
    const entry = this.mcpServerTools.get(name);
    if (!entry) return false;

    for (const tn of entry.toolNames) {
      this.toolRegistry.unregister(tn);
    }

    try { (entry.client as { close?: () => void }).close?.(); } catch {}
    this.mcpClients = this.mcpClients.filter(c => c !== entry.client);
    this.mcpServerTools.delete(name);
    return true;
  }

  /** Refresh MCP server tools when tools/list_changed notification is received */
  private async refreshMcpServerTools(name: string): Promise<void> {
    const entry = this.mcpServerTools.get(name);
    if (!entry) return;

    // Unregister old tools
    for (const tn of entry.toolNames) {
      this.toolRegistry.unregister(tn);
    }

    // Re-add using existing config
    const config = entry.config;
    if (!config) return;

    try {
      const result = await this.addMcpServer(name, config);
      console.log(`MCP tools refreshed for "${name}": ${result.added.length} tools`);
    } catch (err) {
      console.error(`Failed to refresh MCP tools for "${name}": ${(err as Error).message}`);
    }
  }

  setMcpClients(clients: unknown[], serverToolMap?: Record<string, { toolNames: string[]; client: unknown }>): void {
    this.mcpClients = clients;
    if (serverToolMap) {
      for (const [name, entry] of Object.entries(serverToolMap)) {
        this.mcpServerTools.set(name, entry);
      }
    }
  }

  getToolRegistry(): ToolRegistry { return this.toolRegistry; }
  getMcpServerTools(): Map<string, { toolNames: string[]; client: unknown; config?: McpServerConfig }> { return this.mcpServerTools; }
  getSkillRegistry(): SkillRegistry { return this.skillRegistry; }
  getMemory(): MemoryStore | null { return this.memory; }
  getUserProfile(): UserProfile | null { return this.userProfile; }
  getApprovalSystem(): ApprovalSystem { return this.approval; }
  getCredentialPool(): CredentialPool | null { return this.credentialPool; }
  getAuxiliaryClient(): AuxiliaryClient { return this.auxiliaryClient; }

  getHistory(): Message[] { return [...this.messages]; }
  reset(): void { this.messages = []; this.guardrail.reset(); }

  /** Load messages from an external source (e.g., snapshot restore) */
  loadMessages(msgs: Array<{ role: string; content: string }>): void {
    this.messages = msgs.map(m => ({ role: m.role as Message["role"], content: m.content }));
  }

  /** Branch the current session: snapshot messages into a new session ID */
  branch(name: string): string {
    const branchId = `branch_${name}_${Date.now().toString(36)}`;
    // Save current messages as the branched session
    if (this.sessionDb) {
      this.sessionDb.createSession(branchId, `Branch: ${name}`, this.sessionId);
      for (const msg of this.messages) {
        this.sessionDb.saveMessage(branchId, msg);
      }
    }
    // Store branch reference for later resume
    this.branches.set(name, { id: branchId, messages: [...this.messages] });
    return branchId;
  }

  /** Resume a previously branched session by name */
  resumeBranch(name: string): boolean {
    const branch = this.branches.get(name);
    if (!branch) return false;
    // Save current state before switching
    this.messages = [...branch.messages];
    return true;
  }

  /** List all branch names */
  listBranches(): string[] {
    return [...this.branches.keys()];
  }

  /** Delete a branch */
  deleteBranch(name: string): boolean {
    return this.branches.delete(name);
  }

  /** Compress context: summarize conversation into a condensed form */
  async compress(focus?: string): Promise<string> {
    if (this.messages.length === 0) return "Nothing to compress.";

    const originalCount = this.messages.length;

    const summarizer = async (text: string, instruction?: string) => {
      const focusedInstruction = focus
        ? `${instruction ?? "Produce a concise summary."}\n\nFocus especially on: ${focus}. Preserve all details related to this topic verbatim, compress unrelated content aggressively.`
        : instruction;
      return await this.auxiliaryClient.summarize(text, focusedInstruction);
    };

    this.messages = await this.compressor.compress(
      this.messages,
      this.contextWindow,
      summarizer,
    );

    this.compressionCount++;

    if (this.sessionDb) {
      const compressedId = `compressed_${Date.now().toString(36)}`;
      this.sessionDb.createSession(compressedId, `Compressed from ${this.sessionId}`, this.sessionId);
      for (const msg of this.messages) {
        this.sessionDb.saveMessage(compressedId, msg);
      }
    }

    const focusNote = focus ? ` [focus: ${focus}]` : "";
    return `Compressed ${originalCount} messages into ${this.messages.length} messages${focusNote} (total compressions: ${this.compressionCount}).`;
  }

  /** Undo last turn: remove last user + assistant pair */
  undoLastTurn(): boolean {
    if (this.messages.length < 2) return false;
    // Find last user message and remove from there
    let lastUserIdx = -1;
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "user") { lastUserIdx = i; break; }
    }
    if (lastUserIdx === -1) return false;
    this.messages = this.messages.slice(0, lastUserIdx);
    return true;
  }

  /** Get last user input for retry */
  getLastUserInput(): string | null {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === "user") return this.messages[i].content;
    }
    return null;
  }

  /** Update usage tracking from transport response */
  private updateUsage(promptTokens: number, completionTokens: number): void {
    this.lastUsage = { promptTokens, completionTokens };
    this.totalUsage.promptTokens += promptTokens;
    this.totalUsage.completionTokens += completionTokens;
    this.totalUsage.turns++;
    this.checkContextPressure();
  }

  /** Emit tiered context-pressure warnings when crossing thresholds */
  private checkContextPressure(): void {
    const progress = this.getContextProgress();
    if (progress.pressure === this.lastPressureWarned) return;

    // Only emit on escalation (ok → moderate → high → critical), not on de-escalation
    const order = { ok: 0, moderate: 1, high: 2, critical: 3 };
    if (order[progress.pressure] <= order[this.lastPressureWarned]) {
      this.lastPressureWarned = progress.pressure;
      return;
    }

    this.lastPressureWarned = progress.pressure;

    const icon = progress.pressure === "critical" ? "🔴" : progress.pressure === "high" ? "🟠" : "🟡";
    const msg = `${icon} Context pressure: ${progress.pressure.toUpperCase()} (${progress.percent}% — ${progress.usedTokens.toLocaleString()} / ${progress.contextWindow.toLocaleString()} tokens)`;
    console.warn(msg);

    if (progress.pressure === "critical") {
      console.warn("  Consider /compress to free up space before the next turn.");
    }
  }

  /** Get current session usage stats */
  getUsage(): { last: { promptTokens: number; completionTokens: number }; total: { promptTokens: number; completionTokens: number; turns: number } } {
    return { last: { ...this.lastUsage }, total: { ...this.totalUsage } };
  }

  /** Get context window progress for status bar display (Hermes-style) */
  getContextProgress(): {
    usedTokens: number;
    contextWindow: number;
    percent: number;
    model: string;
    compressionCount: number;
    pressure: "ok" | "moderate" | "high" | "critical";
  } {
    const usedTokens = this.lastUsage.promptTokens;
    const percent = this.contextWindow > 0
      ? Math.min(100, Math.round((usedTokens / this.contextWindow) * 100))
      : 0;
    let pressure: "ok" | "moderate" | "high" | "critical" = "ok";
    if (percent >= 95) pressure = "critical";
    else if (percent >= 80) pressure = "high";
    else if (percent >= 60) pressure = "moderate";
    return { usedTokens, contextWindow: this.contextWindow, percent, model: this.model, compressionCount: this.compressionCount, pressure };
  }

  /** Cycle tool progress display mode: off → new → all → verbose → off */
  cycleProgressMode(): "off" | "new" | "all" | "verbose" {
    const order: Array<"off" | "new" | "all" | "verbose"> = ["off", "new", "all", "verbose"];
    const idx = order.indexOf(this.progressMode);
    this.progressMode = order[(idx + 1) % order.length];
    return this.progressMode;
  }

  /** Set tool progress display mode directly */
  setProgressMode(mode: "off" | "new" | "all" | "verbose"): void {
    this.progressMode = mode;
  }

  /** Get/set active personality */
  getPersonality(): PersonalityStore { return this.personality; }

  /** Queue a steer message — injected after next tool call without interrupting current turn */
  setSteerMessage(text: string): void { this.steerMessage = text; }
  /** Clear queued steer message */
  clearSteerMessage(): void { this.steerMessage = null; }
  /** Check if a steer message is pending */
  hasPendingSteer(): boolean { return this.steerMessage !== null; }

  /** Get InsightsEngine for usage analytics */
  getInsightsEngine(): InsightsEngine | null {
    if (!this.sessionDb) return null;
    return new InsightsEngine(this.sessionDb);
  }

  async close(options?: { closeMcp?: boolean }): Promise<void> {
    if (this.memory && this.ownsMemory) this.memory.close();
    const shouldCloseMcp = options?.closeMcp !== false;
    // Close MCP clients only when the agent owns them (not shared/borrowed)
    if (shouldCloseMcp) {
      for (const client of this.mcpClients) {
        if (client && typeof (client as { close?: () => void }).close === "function") {
          (client as { close: () => void }).close();
        }
      }
    }
    this.mcpClients = [];
  }
}
