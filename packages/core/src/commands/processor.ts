/**
 * Command Processor — unified slash command dispatch for all UI paths.
 *
 * Single source of truth for command logic. Both ink and readline
 * call processCommandAsync() and render results via OutputAdapter.
 *
 * Inspired by Hermes TerminalBackend trait — one dispatch, many renderers.
 */

import chalk from "chalk";
import type { Agent, MemoryStore, SessionDB, CronStore, UserProfile } from "../index.js";
import {
  resolveCommand,
  commandsByCategory,
  commandHelpLine,
} from "./registry.js";
import type { CommandDef } from "./registry.js";

// ── Result types ──────────────────────────────────────────────────

export type CommandAction =
  | { type: "output"; lines: string[] }
  | { type: "quit" }
  | { type: "clear" }
  | { type: "skill"; skillName: string; args: string; fullInput: string }
  | { type: "unknown"; cmd: string };

export interface CommandContext {
  agent: Agent;
  memory: MemoryStore;
  sessionDb: SessionDB;
  cronStore: CronStore;
  config: { llm: { protocol: string; model: string; baseUrl: string } };
  userProfile: UserProfile;
}

// ── Output adapter interface ───────────────────────────────────────

export interface OutputAdapter {
  addLine(line: string): void;
  addLines(lines: string[]): void;
  clearScreen(): void;
  setInput(text: string): void;
  quit(): Promise<void>;
  runSkill(fullInput: string): Promise<void>;
}

// ── Shared processor ──────────────────────────────────────────────

export async function processCommandAsync(
  cmd: string,
  ctx: CommandContext,
  adapter: OutputAdapter,
): Promise<boolean> {
  const trimmed = cmd.trim();
  if (!trimmed.startsWith("/")) return false;

  const parts = trimmed.split(/\s+/);
  const base = parts[0];

  // 1. Skill detection (before registry — user-defined skills take priority)
  const skillName = base.replace(/^\/+/, "");
  const skillReg = ctx.agent.getSkillRegistry();
  const skill = skillReg?.get(skillName);
  if (skill?.userInvocable) {
    await adapter.runSkill(trimmed);
    return true;
  }

  // 2. Command resolution (supports aliases)
  const resolved = resolveCommand(base);
  const canonical = resolved ? resolved.name : base.replace(/^\//, "");

  // 2b. Plugin command dispatch — check before builtin switch so plugins can extend
  if (!resolved) {
    const pluginCmdName = base.replace(/^\//, "");
    const pluginCmd = ctx.agent.pluginSystem.resolveCommand(pluginCmdName);
    if (pluginCmd) {
      try {
        const args = parts.slice(1).join(" ");
        const output = await pluginCmd.handler(args, pluginCmd.context);
        if (output) adapter.addLine(output);
      } catch (err) {
        adapter.addLine(chalk.red(`  Plugin command "/${pluginCmdName}" failed: ${(err as Error).message}`));
      }
      return true;
    }
  }

  // 3. Dispatch
  switch (canonical) {
    // ── Exit ──
    case "quit":
    case "exit":
      await adapter.quit();
      return true;

    // ── Session ──
    case "help":
      return cmdHelp(adapter, skillReg);

    case "new":
      ctx.agent.reset();
      adapter.addLines([chalk.green("✓ New session."), chalk.gray("─".repeat(60))]);
      return true;

    case "save":
      return cmdSave(ctx, adapter);

    case "retry":
      return cmdRetry(ctx, adapter);

    case "reset":
      ctx.agent.reset();
      adapter.addLine(chalk.gray("✓ Conversation reset."));
      return true;

    case "history":
      return cmdHistory(ctx, adapter);

    case "undo": {
      const ok = ctx.agent.undoLastTurn();
      adapter.addLine(ok ? chalk.green("  ✓ Last turn undone.") : chalk.gray("  Nothing to undo."));
      return true;
    }

    case "title":
      return cmdTitle(ctx, adapter, parts);

    case "compress": {
      const focus = parts.slice(1).join(" ").trim();
      adapter.addLine(chalk.gray(focus ? `  Compressing (focus: "${focus}")...` : "  Compressing..."));
      try {
        const msg = await ctx.agent.compress(focus || undefined);
        adapter.addLine(chalk.green(`  ✓ ${msg}`));
      } catch (err) {
        adapter.addLine(chalk.red(`  ✗ ${(err as Error).message}`));
      }
      return true;
    }

    case "branch":
      return cmdBranch(ctx, adapter, parts);

    case "resume":
      return cmdResume(ctx, adapter, parts);

    case "snapshot":
      return cmdSnapshot(ctx, adapter, parts);

    case "goal":
      return cmdGoal(ctx, adapter, parts);

    case "stop":
      return cmdStop(ctx, adapter);

    case "agents":
      return cmdAgents(ctx, adapter);

    case "queue":
      return cmdQueue(ctx, adapter, parts);

    case "steer":
      return cmdSteer(ctx, adapter, parts);

    case "rollback":
      return cmdRollback(ctx, adapter, parts);

    case "copy":
      return cmdCopy(ctx, adapter);

    case "paste":
      return cmdPaste(ctx, adapter);

    case "clear":
    case "redraw":
      adapter.clearScreen();
      adapter.addLine(chalk.green("  ✓ Screen cleared."));
      return true;

    // ── Configuration ──
    case "config":
      return cmdConfig(ctx, adapter);

    case "model":
      adapter.addLines([
        chalk.gray(`  ${ctx.config.llm.protocol} | ${ctx.config.llm.model}`),
        chalk.gray(`  Base: ${ctx.config.llm.baseUrl}`),
      ]);
      return true;

    case "verbose":
      return cmdVerbose(ctx, adapter, parts);

    case "personality":
      return cmdPersonality(ctx, adapter, parts);

    case "skin":
      return cmdSkin(ctx, adapter, parts);

    case "statusbar":
      return cmdStatusbar(ctx, adapter, parts);

    case "onboarding":
      return cmdOnboarding(adapter);

    case "lang":
      return cmdLang(adapter, parts);

    case "voice":
      return cmdVoice(ctx, adapter, parts);

    case "yolo":
      return cmdYolo(ctx, adapter);

    case "reasoning":
      return cmdReasoning(ctx, adapter, parts);

    case "fast":
      return cmdFast(ctx, adapter, parts);

    case "footer":
      return cmdFooter(ctx, adapter, parts);

    case "indicator":
      return cmdIndicator(ctx, adapter, parts);

    case "busy":
      return cmdBusy(ctx, adapter, parts);

    // ── Memory ──
    case "memory":
      return cmdMemory(ctx, adapter);

    case "remember":
      if (parts.length < 2) { adapter.addLine(chalk.gray("  Usage: /remember <text>")); return true; }
      ctx.memory.add(parts.slice(1).join(" "), "user", "manual");
      adapter.addLine(chalk.green("✓ Saved to memory."));
      return true;

    case "forget": {
      if (parts.length < 2) { adapter.addLine(chalk.gray("  Usage: /forget <keyword>")); return true; }
      const removed = ctx.memory.remove(parts.slice(1).join(" "));
      adapter.addLine(chalk.gray(`✓ Removed ${removed} memory(ies).`));
      return true;
    }

    case "search":
      return cmdSearch(ctx, adapter, parts);

    case "profile": {
      const profile = ctx.userProfile;
      const data = profile.toJSON();
      const lines = Object.entries(data).map(([k, v]) => `  ${chalk.cyan(k)}: ${v}`);
      adapter.addLines(lines.length > 0 ? lines : [chalk.gray("  Profile is empty.")]);
      return true;
    }

    case "sessions":
      return cmdSessions(ctx, adapter, parts);

    case "honcho":
      return cmdHoncho(ctx, adapter, parts);

    // ── Tools ──
    case "tools":
      return cmdTools(ctx, adapter);

    case "toolsets":
      return cmdToolsets(ctx, adapter);

    case "skills":
      return cmdSkills(ctx, adapter, parts);

    case "mcp":
      return cmdMcp(ctx, adapter, parts);

    case "curator":
      return cmdCurator(ctx, adapter);

    case "plugin":
      return cmdPlugin(ctx, adapter, parts);

    case "reload":
      return cmdReload(ctx, adapter);

    case "reload-mcp":
      return cmdReloadMcp(ctx, adapter);

    case "reload-skills":
      return cmdReloadSkills(ctx, adapter);

    case "browser":
      return cmdBrowser(ctx, adapter, parts);

    case "image":
      return cmdImage(ctx, adapter, parts);

    case "kanban":
      return cmdKanban(ctx, adapter, parts);

    case "sandbox":
      return cmdSandbox(ctx, adapter, parts);

    case "security":
      return cmdSecurity(adapter, parts);

    // ── Info ──
    case "usage":
      return cmdUsage(ctx, adapter);

    case "insights":
      return cmdInsights(ctx, adapter, parts);

    case "bg":
      return cmdBg(ctx, adapter, parts);

    case "status":
      return cmdStatus(ctx, adapter);

    case "debug":
      return cmdDebug(ctx, adapter);

    case "logs":
      return cmdLogs(adapter, parts);

    case "update":
      return cmdUpdate(adapter);

    case "cron":
      return cmdCron(ctx, adapter, parts);

    case "trajectory":
      return cmdTrajectory(ctx, adapter);

    default:
      adapter.addLines([
        chalk.yellow(`  Unknown: ${base}`),
        chalk.gray("  Type /help to see available commands."),
      ]);
      return true;
  }
}

// ── Individual command implementations ─────────────────────────────

function cmdHelp(adapter: OutputAdapter, skillReg: { list: () => Array<{ name: string; userInvocable?: boolean; description?: string }> }): boolean {
  const lines: string[] = [chalk.cyan("  Commands:")];
  const groups = commandsByCategory();
  for (const [category, cmds] of Object.entries(groups)) {
    if (cmds.length === 0) continue;
    lines.push("", chalk.yellow(`  ── ${category} ──`));
    for (const c of cmds) {
      lines.push(`  ${chalk.white(commandHelpLine(c))}`);
    }
  }
  const invocableSkills = skillReg.list().filter(s => s.userInvocable);
  if (invocableSkills.length > 0) {
    lines.push("", chalk.yellow("  ── Skills ──"));
    for (const s of invocableSkills) {
      lines.push(`  ${chalk.white(`/${s.name}`)} — ${(s.description ?? "").slice(0, 80)}`);
    }
  }
  adapter.addLines(lines);
  return true;
}

function cmdHistory(ctx: CommandContext, adapter: OutputAdapter): boolean {
  const history = ctx.agent.getHistory();
  if (history.length === 0) {
    adapter.addLine(chalk.gray("  (empty)"));
    return true;
  }
  const rc: Record<string, { glyph: string; style: (s: string) => string }> = {
    user: { glyph: "❯", style: chalk.green },
    assistant: { glyph: "◆", style: chalk.magenta },
    tool: { glyph: "┊", style: chalk.gray },
  };
  const lines = history.map(msg => {
    const r = rc[msg.role] ?? { glyph: "·", style: chalk.gray };
    const limit = msg.role === "tool" ? 100 : 200;
    return `  ${r.style(r.glyph)} ${(msg.content ?? "").slice(0, limit)}`;
  });
  adapter.addLines(lines);
  return true;
}

function cmdBranch(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const branchName = parts[1];
  if (!branchName) {
    const branches = ctx.agent.listBranches();
    if (branches.length === 0) {
      adapter.addLine(chalk.gray("  No branches. Usage: /branch <name>"));
    } else {
      adapter.addLines([
        chalk.cyan("  Branches:"),
        ...branches.map(b => `    ${chalk.white(b)}`),
        chalk.gray("  /branch <name> to create, /resume <name> to switch"),
      ]);
    }
  } else {
    ctx.agent.branch(branchName);
    adapter.addLines([
      chalk.green(`  ✓ Branch "${branchName}" created (from current point)`),
      chalk.gray(`  Use /resume ${branchName} to switch to this branch`),
    ]);
  }
  return true;
}

function cmdResume(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const branchName = parts[1];
  if (!branchName) {
    // List branches AND recent sessions so user can pick
    const branches = ctx.agent.listBranches();
    const sessions = ctx.sessionDb.recentSessions(10);

    const lines: string[] = [];

    if (branches.length > 0) {
      lines.push(chalk.cyan("  Branches:"));
      for (const b of branches) {
        lines.push(`    ${chalk.green("●")} ${chalk.white(b)}  ${chalk.gray("→ /resume " + b)}`);
      }
      lines.push("");
    }

    if (sessions.length > 0) {
      lines.push(chalk.cyan("  Recent sessions:"));
      for (const s of sessions) {
        const raw = s as any;
        const title = raw.title || raw.id?.slice(0, 20) || "untitled";
        const date = (raw.created_at || raw.createdAt || "").slice(0, 16);
        const msgs = chalk.gray(`${raw.message_count ?? raw.messageCount ?? 0} msgs`);
        lines.push(`    ${chalk.yellow("◆")} ${chalk.white(title)}  ${msgs}  ${chalk.gray(date)}`);
      }
      lines.push("");
      lines.push(chalk.gray("  Usage: /resume <branch-name>"));
      lines.push(chalk.gray("  Tip: branch names are listed above with ● markers"));
    } else if (branches.length === 0) {
      lines.push(chalk.gray("  No branches or sessions to resume."));
      lines.push(chalk.gray("  Create a branch first: /branch <name>"));
    }

    adapter.addLines(lines);
  } else {
    const ok = ctx.agent.resumeBranch(branchName);
    if (ok) {
      adapter.addLines([
        chalk.green(`  ✓ Resumed branch "${branchName}"`),
        chalk.gray("─".repeat(60)),
      ]);
    } else {
      adapter.addLine(chalk.red(`  ✗ Branch "${branchName}" not found`));
    }
  }
  return true;
}

function cmdSnapshot(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const sub = parts[1];
  const agent = ctx.agent;

  if (!sub || sub === "list") {
    const snapshots = agent.snapshots.list();
    if (snapshots.length === 0) {
      adapter.addLine(chalk.gray("  No snapshots. Usage: /snapshot create <name>"));
    } else {
      adapter.addLines([
        chalk.cyan("  Snapshots:"),
        ...snapshots.map(s => {
          const date = s.createdAt.slice(0, 16).replace("T", " ");
          return `    ${chalk.white(s.name)} ${chalk.gray(`[${s.id}]`)} ${chalk.gray(`${s.messageCount} msgs, ${s.memoryCount} mems`)} ${chalk.gray(date)}`;
        }),
      ]);
    }
  } else if (sub === "create") {
    const snapName = parts.slice(2).join(" ") || "unnamed";
    const meta = agent.snapshots.create(snapName, {
      messages: agent.getHistory(),
      memory: (agent as any)["memory"] ?? null,
      sessionDb: (agent as any)["sessionDb"] ?? null,
      sessionId: (agent as any)["sessionId"] ?? "",
      goalManager: (agent as any)["goalManager"] ?? null,
      goalSessionId: (agent as any)["sessionId"] ?? "",
    });
    adapter.addLines([
      chalk.green(`  ✓ Snapshot "${snapName}" created [${meta.id}]`),
      chalk.gray(`    ${meta.messageCount} messages, ${meta.memoryCount} memories`),
    ]);
  } else if (sub === "restore") {
    const snapId = parts[2];
    if (!snapId) {
      adapter.addLine(chalk.gray("  Usage: /snapshot restore <id>"));
    } else {
      const msgs = agent.snapshots.restoreMessages(snapId);
      if (msgs) {
        agent.loadMessages(msgs);
        adapter.addLines([
          chalk.green(`  ✓ Restored snapshot [${snapId}] (${msgs.length} messages)`),
          chalk.gray("─".repeat(60)),
        ]);
      } else {
        adapter.addLine(chalk.red(`  ✗ Snapshot "${snapId}" not found or has no messages`));
      }
    }
  } else if (sub === "prune") {
    const days = parts[2] ? parseInt(parts[2]) : 30;
    const count = agent.snapshots.prune(days);
    adapter.addLine(chalk.green(`  ✓ Pruned ${count} snapshot(s) older than ${days} days`));
  } else {
    adapter.addLine(chalk.gray("  Usage: /snapshot [create|restore|list|prune]"));
  }
  return true;
}

function cmdGoal(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const sub = parts[1];
  const agent = ctx.agent;

  if (!sub || sub === "status") {
    const goal = agent.getGoal();
    if (!goal) {
      adapter.addLine(chalk.gray("  No active goal. Usage: /goal <text> to set one."));
    } else {
      const lines = [
        chalk.cyan(`  Goal: ${goal.goal}`),
        chalk.gray(`  Status: ${goal.status} | Turns: ${goal.turnsUsed}/${goal.maxTurns}`),
      ];
      if (goal.lastVerdict) lines.push(chalk.gray(`  Last verdict: ${goal.lastVerdict} — ${goal.lastReason ?? ""}`));
      if (goal.pausedReason) lines.push(chalk.yellow(`  Paused: ${goal.pausedReason}`));
      adapter.addLines(lines);
    }
  } else if (sub === "pause") {
    agent.pauseGoal("user paused");
    adapter.addLine(chalk.yellow("  ⏸ Goal paused."));
  } else if (sub === "resume") {
    const ok = agent.resumeGoal();
    adapter.addLine(ok ? chalk.green("  ▶ Goal resumed.") : chalk.gray("  No paused goal to resume."));
  } else if (sub === "clear") {
    agent.clearGoal();
    adapter.addLine(chalk.gray("  ✓ Goal cleared."));
  } else {
    const goalText = parts.slice(1).join(" ");
    agent.setGoal(goalText);
    adapter.addLines([
      chalk.green(`  ✓ Goal set: ${goalText}`),
      chalk.gray("  Agent will continue working toward this goal across turns."),
      chalk.gray("  Use /goal status, /goal pause, /goal resume, or /goal clear."),
    ]);
  }
  return true;
}

function cmdCopy(ctx: CommandContext, adapter: OutputAdapter): boolean {
  const { copyToClipboard, isClipboardAvailable } = require("../index.js") as typeof import("../index.js");
  if (!isClipboardAvailable()) {
    adapter.addLine(chalk.red("  ✗ Clipboard not available on this system"));
    return true;
  }
  const history = ctx.agent.getHistory();
  const lastAssistant = [...history].reverse().find(m => m.role === "assistant");
  if (!lastAssistant?.content) {
    adapter.addLine(chalk.gray("  No assistant output to copy."));
    return true;
  }
  const ok = copyToClipboard(lastAssistant.content);
  adapter.addLine(ok ? chalk.green(`  ✓ Copied ${lastAssistant.content.length} chars to clipboard`) : chalk.red("  ✗ Copy failed"));
  return true;
}

function cmdPaste(ctx: CommandContext, adapter: OutputAdapter): boolean {
  const { pasteFromClipboard, isClipboardAvailable } = require("../index.js") as typeof import("../index.js");
  if (!isClipboardAvailable()) {
    adapter.addLine(chalk.red("  ✗ Clipboard not available on this system"));
    return true;
  }
  const text = pasteFromClipboard();
  if (!text) {
    adapter.addLine(chalk.gray("  Clipboard is empty."));
    return true;
  }
  adapter.setInput(text.slice(0, 500));
  adapter.addLine(chalk.green(`  ✓ Pasted ${text.length} chars from clipboard — press Enter to submit`));
  return true;
}

function cmdTitle(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const agent = ctx.agent as any;
  const sessionId = agent["sessionId"] ?? "";
  const title = parts.slice(1).join(" ");
  if (!title) {
    let current: string | null = null;
    if (sessionId && typeof (ctx.sessionDb as any).getSessionTitle === "function") {
      current = (ctx.sessionDb as any).getSessionTitle(sessionId);
    }
    adapter.addLine(chalk.gray(`  Current title: ${current ?? "(untitled)"}`));
    adapter.addLine(chalk.gray("  Usage: /title <name>"));
  } else {
    if (sessionId && typeof (ctx.sessionDb as any).setSessionTitle === "function") {
      (ctx.sessionDb as any).setSessionTitle(sessionId, title);
    }
    adapter.addLine(chalk.green(`  ✓ Title set: ${title}`));
  }
  return true;
}

function cmdRetry(ctx: CommandContext, adapter: OutputAdapter): boolean {
  const history = ctx.agent.getHistory();
  const lastUser = [...history].reverse().find(m => m.role === "user");
  if (!lastUser?.content) {
    adapter.addLine(chalk.gray("  No user message to retry."));
    return true;
  }
  ctx.agent.undoLastTurn();
  adapter.addLine(chalk.green(`  ✓ Retrying: ${lastUser.content.slice(0, 80)}${lastUser.content.length > 80 ? "..." : ""}`));
  adapter.setInput(lastUser.content);
  return true;
}

function cmdSave(ctx: CommandContext, adapter: OutputAdapter): boolean {
  const history = ctx.agent.getHistory();
  if (history.length === 0) {
    adapter.addLine(chalk.gray("  Nothing to save — session is empty."));
    return true;
  }
  const agent = ctx.agent as any;
  const sessionId = agent["sessionId"] ?? "";
  if (sessionId && ctx.sessionDb) {
    for (const msg of history) {
      ctx.sessionDb.mirrorToSession(sessionId, msg.role, msg.content ?? "");
    }
    adapter.addLine(chalk.green(`  ✓ Saved ${history.length} messages to session [${sessionId.slice(0, 12)}]`));
  } else {
    adapter.addLine(chalk.yellow("  ⚠ No active session ID — messages are in-memory only"));
  }
  return true;
}

function cmdConfig(ctx: CommandContext, adapter: OutputAdapter): boolean {
  const agent = ctx.agent as any;
  const lines: string[] = [
    chalk.cyan("  Configuration:"),
    `    Protocol: ${chalk.white(ctx.config.llm.protocol)}`,
    `    Model: ${chalk.white(ctx.config.llm.model)}`,
    `    Base URL: ${chalk.white(ctx.config.llm.baseUrl)}`,
    `    Progress mode: ${chalk.white(ctx.agent.progressMode)}`,
    `    Status bar: ${chalk.white(ctx.agent.statusBarMode)}`,
    `    Voice mode: ${chalk.white(ctx.agent.voiceMode)}`,
  ];
  const personality = ctx.agent.getPersonality();
  if (personality) lines.push(`    Personality: ${chalk.white(personality.getActiveName())}`);
  const skin = ctx.agent.skin;
  if (skin) lines.push(`    Skin: ${chalk.white(skin.getActiveName())}`);
  if (agent["maxTurns"]) lines.push(`    Max turns: ${chalk.white(agent["maxTurns"])}`);
  adapter.addLines(lines);
  return true;
}

function cmdVerbose(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const sub = parts[1];
  const modeDescriptions: Record<string, string> = {
    off: "No tool output shown",
    new: "Show only new/different tools",
    all: "Show all tool outputs",
    verbose: "Show all + args + result preview",
  };
  if (sub && ["off", "new", "all", "verbose"].includes(sub)) {
    ctx.agent.setProgressMode(sub as "off" | "new" | "all" | "verbose");
  } else {
    ctx.agent.cycleProgressMode();
  }
  adapter.addLines([
    chalk.green(`  ✓ Tool output mode: ${ctx.agent.progressMode}`),
    chalk.gray(`    ${modeDescriptions[ctx.agent.progressMode]}`),
  ]);
  return true;
}

function cmdPersonality(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const personality = ctx.agent.getPersonality();
  const sub = parts[1];
  if (!sub || sub === "list") {
    const names = personality.list();
    const active = personality.getActiveName();
    if (names.length === 0) {
      adapter.addLine(chalk.gray("  No personalities configured. Create one in ~/.skeleton/personalities/"));
    } else {
      adapter.addLines([
        chalk.cyan("  Personalities:"),
        ...names.map(n => `    ${chalk.white(n)}${n === active ? chalk.green(" ← active") : ""}`),
        chalk.gray("  Usage: /personality <name> to switch"),
      ]);
    }
  } else {
    const ok = personality.setActive(sub);
    if (ok) {
      adapter.addLine(chalk.green(`  ✓ Personality: ${sub}`));
    } else {
      adapter.addLine(chalk.red(`  ✗ "${sub}" not found. Available: ${personality.list().join(", ") || "(none)"}`));
    }
  }
  return true;
}

function cmdSkin(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const skinMgr = ctx.agent.skin;
  const sub = parts[1];
  if (!sub || sub === "list") {
    const skins = skinMgr.list();
    const active = skinMgr.getActiveName();
    adapter.addLines([
      chalk.cyan("  Skins:"),
      ...skins.map(s => `    ${chalk.white(s.name)}${s.description ? chalk.gray(` — ${s.description}`) : ""}${s.name === active ? chalk.green(" ← active") : ""}`),
      chalk.gray("  Usage: /skin <name> to switch"),
    ]);
  } else {
    const ok = skinMgr.setActive(sub);
    if (ok) {
      adapter.addLine(chalk.green(`  ✓ Skin: ${sub}`));
    } else {
      adapter.addLine(chalk.red(`  ✗ Skin "${sub}" not found. Available: ${skinMgr.listNames().join(", ")}`));
    }
  }
  return true;
}

function cmdStatusbar(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const sub = parts[1];
  const modes = ["compact", "normal", "detailed"] as const;
  const desc: Record<string, string> = {
    compact: "Model + streaming indicator only",
    normal: "Model + tools + MCP + context bar",
    detailed: "Normal + token counts + session stats + personality + skin",
  };
  if (sub && modes.includes(sub as typeof modes[number])) {
    ctx.agent.statusBarMode = sub as typeof modes[number];
  } else {
    const idx = modes.indexOf(ctx.agent.statusBarMode);
    ctx.agent.statusBarMode = modes[(idx + 1) % modes.length];
  }
  adapter.addLines([
    chalk.green(`  ✓ Status bar: ${ctx.agent.statusBarMode}`),
    chalk.gray(`    ${desc[ctx.agent.statusBarMode]}`),
  ]);
  return true;
}

async function cmdOnboarding(adapter: OutputAdapter): Promise<boolean> {
  adapter.addLines([
    chalk.cyan("  Starting onboarding wizard..."),
    chalk.gray("  This will guide you through provider selection and API key setup."),
    chalk.gray("  Press Ctrl+C at any time to cancel."),
  ]);
  try {
    const { OnboardingManager } = await import("../onboarding.js");
    const mgr = new OnboardingManager();
    const state = await mgr.runOnboarding();
    if (state.completed) {
      adapter.addLines([
        chalk.green("  ✓ Onboarding complete!"),
        chalk.gray(`  Provider: ${state.provider} | Model: ${state.model}`),
        chalk.gray("  Restart Skeleton to apply your new configuration."),
      ]);
    }
  } catch (err) {
    adapter.addLine(chalk.red(`  ✗ Onboarding failed: ${(err as Error).message}`));
  }
  return true;
}

function cmdLang(adapter: OutputAdapter, parts: string[]): boolean {
  const { supportedLanguages, setLanguage } = require("../index.js") as typeof import("../index.js");
  const langs = supportedLanguages();
  const sub = parts[1];
  if (!sub) {
    adapter.addLines([
      chalk.cyan("  Languages:"),
      `    ${langs.map(l => chalk.white(l)).join(", ")}`,
      chalk.gray("  Usage: /lang <code> to switch"),
    ]);
  } else if (langs.includes(sub)) {
    setLanguage(sub);
    adapter.addLine(chalk.green(`  ✓ Language: ${sub}`));
  } else {
    adapter.addLine(chalk.red(`  ✗ Unsupported: ${sub}. Available: ${langs.join(", ")}`));
  }
  return true;
}

function cmdVoice(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const sub = parts[1];
  const modes = ["off", "tts", "stt", "on"] as const;
  const desc: Record<string, string> = { off: "No voice", tts: "Text-to-speech output", stt: "Speech-to-text input", on: "Full voice mode" };
  if (sub && modes.includes(sub as typeof modes[number])) {
    ctx.agent.voiceMode = sub as typeof modes[number];
  } else {
    const idx = modes.indexOf(ctx.agent.voiceMode);
    ctx.agent.voiceMode = modes[(idx + 1) % modes.length];
  }
  adapter.addLines([
    chalk.green(`  ✓ Voice mode: ${ctx.agent.voiceMode}`),
    chalk.gray(`    ${desc[ctx.agent.voiceMode]}`),
  ]);
  return true;
}

function cmdMemory(ctx: CommandContext, adapter: OutputAdapter): boolean {
  const all = ctx.memory.list();
  if (all.length === 0) {
    adapter.addLine(chalk.gray("  No memories yet."));
  } else {
    adapter.addLines(all.map(m => `  ${chalk.yellow(`[${m.category}]`)} ${m.content.slice(0, 120)}`));
  }
  return true;
}

function cmdSearch(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  if (parts.length < 2) { adapter.addLine(chalk.gray("  Usage: /search <query>")); return true; }
  const results = ctx.sessionDb.search(parts.slice(1).join(" "));
  if (results.length === 0) {
    adapter.addLine(chalk.gray("  No results."));
  } else {
    adapter.addLines(results.map(r => `  ${chalk.gray(`[${r.role}]`)} ${r.content.slice(0, 150)}`));
  }
  return true;
}

function cmdSessions(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const sub = parts[1];
  if (sub === "search" && parts[2]) {
    const results = ctx.sessionDb.search(parts.slice(2).join(" "));
    if (results.length === 0) {
      adapter.addLine(chalk.gray("  No results."));
    } else {
      adapter.addLines(results.map(r => `  ${chalk.gray(`[${r.role}]`)} ${r.content.slice(0, 150)}`));
    }
  } else {
    const sessions = ctx.sessionDb.recentSessions(15);
    if (sessions.length === 0) {
      adapter.addLine(chalk.gray("  No past sessions."));
    } else {
      adapter.addLines([
        chalk.cyan("  Recent sessions:"),
        ...sessions.map(s => `    ${chalk.white(s.id.slice(0, 16))} ${chalk.gray(`${s.messageCount} msgs`)} ${s.title ?? ""}`),
      ]);
    }
  }
  return true;
}

function cmdHoncho(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const honcho = (ctx.agent as any)["honcho"];
  const sub = parts[1];
  if (!sub || sub === "list") {
    const hyps = honcho.getHypotheses();
    if (hyps.length === 0) {
      adapter.addLine(chalk.gray("  No hypotheses yet. Observations accumulate as you chat."));
    } else {
      adapter.addLines([
        chalk.cyan("  User model hypotheses:"),
        ...hyps.slice(0, 10).map((h: any) => {
          const bar = "█".repeat(Math.round(h.confidence * 10));
          return `    ${chalk.white(h.category)}: ${h.claim} ${chalk.gray(`[${bar} ${Math.round(h.confidence * 100)}%]`)}`;
        }),
      ]);
    }
  } else if (sub === "reconcile") {
    const removed = honcho.reconcile();
    adapter.addLine(chalk.green(`  ✓ Reconciled: ${removed} contradictions resolved`));
  } else if (sub === "observe" && parts[2]) {
    honcho.addObservation("manual", parts.slice(2).join(" "), true);
    adapter.addLine(chalk.green("  ✓ Observation recorded"));
  }
  return true;
}

function cmdTools(ctx: CommandContext, adapter: OutputAdapter): boolean {
  const registry = ctx.agent.getToolRegistry();
  const toolList = registry.list();
  if (toolList.length === 0) {
    adapter.addLine(chalk.gray("  No tools registered."));
  } else {
    adapter.addLines(toolList.map(t => `  ${chalk.cyan(t.name)} — ${t.description.slice(0, 80)}`));
  }
  return true;
}

function cmdCurator(ctx: CommandContext, adapter: OutputAdapter): boolean {
  const { SkillCurator } = require("../skills/index.js") as typeof import("../skills/index.js");
  const curator = new SkillCurator(ctx.agent.getSkillRegistry());
  const report = curator.run();
  const lines = curator.formatReport(report).split("\n");
  adapter.addLines(lines.map(l => chalk.white(`  ${l}`)));
  if (report.autoFixed > 0) adapter.addLine(chalk.green(`  ✓ Auto-fixed ${report.autoFixed} skill(s)`));
  if (report.duplicates.length > 0) adapter.addLine(chalk.yellow(`  ⚠ ${report.duplicates.length} duplicate(s) detected`));
  return true;
}

function cmdPlugin(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const sub = parts[1];
  const ps = ctx.agent.pluginSystem;

  if (!sub || sub === "list") {
    const loaded = ps.listLoaded();
    if (loaded.length === 0) {
      adapter.addLine(chalk.gray("  No plugins loaded. Place plugins in ~/.skeleton/plugins/"));
    } else {
      adapter.addLines([
        chalk.cyan("  Loaded plugins:"),
        ...loaded.map(p => `    ${chalk.white(p.name)} v${p.version} ${p.description ? chalk.gray(`— ${p.description}`) : ""}`),
      ]);
    }
    const discovered = ps.discover();
    if (discovered.length > loaded.length) {
      adapter.addLine(chalk.gray(`  ${discovered.length - loaded.length} plugin(s) discovered but not loaded`));
    }
  } else if (sub === "load") {
    adapter.addLine(chalk.gray("  Loading plugins..."));
    ps.loadAll().then(loaded => {
      for (const m of loaded) adapter.addLine(chalk.green(`  ✓ Loaded: ${m.name} v${m.version}`));
      adapter.addLine(chalk.gray(`  ${loaded.length} plugin(s) loaded`));
    }).catch(err => adapter.addLine(chalk.red(`  ✗ ${err.message}`)));
  } else if (sub === "unload") {
    const name = parts[2];
    if (!name) { adapter.addLine(chalk.gray("  Usage: /plugin unload <name>")); return true; }
    ps.unloadPlugin(name).then(ok => {
      adapter.addLine(ok ? chalk.green(`  ✓ Unloaded: ${name}`) : chalk.red(`  ✗ Plugin "${name}" not found`));
    });
  } else if (sub === "reload") {
    const name = parts[2];
    if (!name) { adapter.addLine(chalk.gray("  Usage: /plugin reload <name>")); return true; }
    ps.reloadPlugin(name).then(m => {
      adapter.addLine(m ? chalk.green(`  ✓ Reloaded: ${m.name} v${m.version}`) : chalk.red(`  ✗ Plugin "${name}" not found`));
    });
  }
  return true;
}

async function cmdSecurity(adapter: OutputAdapter, parts: string[]): Promise<boolean> {
  const sub = parts[1];
  if (sub === "check" && parts[2]) {
    adapter.addLine(chalk.gray(`  Scanning ${parts[2]}...`));
    try {
      const { checkPackageSecurity, formatVulnerabilityReport } = await import("../osv-security.js");
      const report = await checkPackageSecurity(parts[2]);
      adapter.addLine(formatVulnerabilityReport(report));
    } catch (err) {
      adapter.addLine(chalk.red(`  ✗ ${(err as Error).message}`));
    }
  } else {
    adapter.addLine(chalk.gray("  Usage: /security check <package-name>"));
  }
  return true;
}

function cmdUsage(ctx: CommandContext, adapter: OutputAdapter): boolean {
  const usage = ctx.agent.getUsage();
  const ctxP = ctx.agent.getContextProgress();
  adapter.addLines([
    chalk.cyan("  Last turn:"),
    `    Prompt: ${usage.last.promptTokens} | Completion: ${usage.last.completionTokens}`,
    chalk.cyan("  Session total:"),
    `    Prompt: ${usage.total.promptTokens} | Completion: ${usage.total.completionTokens} | Turns: ${usage.total.turns}`,
    chalk.cyan("  Context window:"),
    `    ${ctxP.usedTokens}/${ctxP.contextWindow} ${ctxP.percent}%`,
  ]);
  return true;
}

function cmdInsights(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const insights = ctx.agent.getInsightsEngine();
  if (!insights) {
    adapter.addLine(chalk.gray("  Session database not available — insights require a session DB"));
  } else {
    const days = parts[1] ? parseInt(parts[1]) : 30;
    const report = insights.generate(days);
    const lines = insights.formatTerminal(report).split("\n");
    adapter.addLines(lines);
  }
  return true;
}

function cmdBg(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const sub = parts[1];
  if (!sub || sub === "list") {
    const tasks = ctx.agent.bgTasks.list();
    if (tasks.length === 0) {
      adapter.addLine(chalk.gray("  No background tasks."));
    } else {
      adapter.addLines([
        chalk.cyan("  Background tasks:"),
        ...tasks.map(t => {
          const statusColor = t.status === "running" ? chalk.yellow : t.status === "completed" ? chalk.green : chalk.red;
          return `    ${chalk.white(t.id)} ${statusColor(t.status)} ${chalk.gray(t.command.slice(0, 60))}`;
        }),
      ]);
    }
  } else if (sub === "kill" && parts[2]) {
    const ok = ctx.agent.bgTasks.kill(parts[2]);
    adapter.addLine(ok ? chalk.green(`  ✓ Killed ${parts[2]}`) : chalk.red(`  ✗ Task ${parts[2]} not found`));
  } else if (sub === "status" && parts[2]) {
    const task = ctx.agent.bgTasks.get(parts[2]);
    if (task) {
      adapter.addLine(`  ${chalk.white(task.id)}: ${task.status} | ${task.command}`);
    } else {
      adapter.addLine(chalk.gray(`  Task ${parts[2]} not found`));
    }
  }
  return true;
}

function cmdStatus(ctx: CommandContext, adapter: OutputAdapter): boolean {
  const { getAgentStatus, formatAgentStatus } = require("../agent-status.js") as typeof import("../agent-status.js");
  const status = getAgentStatus(ctx.agent);
  const lines = formatAgentStatus(status).split("\n");
  adapter.addLines(lines);
  return true;
}

function cmdDebug(ctx: CommandContext, adapter: OutputAdapter): boolean {
  const { generateDebugReport, formatDebugReport, saveDebugReport } = require("../debug-report.js") as typeof import("../debug-report.js");
  const report = generateDebugReport(ctx.agent);
  const formatted = formatDebugReport(report);
  adapter.addLines(formatted.split("\n"));
  const savedPath = saveDebugReport(report);
  adapter.addLine(chalk.gray(`  Report saved: ${savedPath}`));
  return true;
}

function cmdLogs(adapter: OutputAdapter, parts: string[]): boolean {
  const { tailLog, filterLog, getLogDir } = require("../logger/index.js") as typeof import("../logger/index.js");

  const file: "agent" | "errors" = parts[1] === "errors" ? "errors" : "agent";
  const rest = parts.slice(parts[1] === "agent" || parts[1] === "errors" ? 2 : 1);

  let lines: string[];
  const grepIdx = rest.indexOf("--grep");
  if (grepIdx >= 0 && rest[grepIdx + 1]) {
    const grep = rest[grepIdx + 1];
    lines = filterLog(file, { grep }, 100);
    adapter.addLine(chalk.gray(`  ${file}.log — filtering by "${grep}" (${lines.length} matches)`));
  } else {
    const n = parseInt(rest[0] ?? "50", 10);
    lines = tailLog(file, isNaN(n) ? 50 : n);
    adapter.addLine(chalk.gray(`  ${file}.log — last ${lines.length} lines (${getLogDir()})`));
  }

  if (lines.length === 0) {
    adapter.addLine(chalk.gray("  (no entries)"));
    return true;
  }

  for (const line of lines) {
    try {
      const p = JSON.parse(line);
      const color = p.level === "error" ? chalk.red : p.level === "warn" ? chalk.yellow : p.level === "info" ? chalk.cyan : chalk.gray;
      adapter.addLine(`  ${color(`[${p.level.toUpperCase()}]`)} ${chalk.gray(p.ts.slice(11, 19))} ${chalk.white(p.prefix)}: ${p.msg}`);
    } catch {
      adapter.addLine(`  ${chalk.gray(line)}`);
    }
  }
  return true;
}

async function cmdUpdate(adapter: OutputAdapter): Promise<boolean> {
  adapter.addLine(chalk.gray("  Checking for updates..."));
  try {
    const { checkForUpdate } = await import("../update.js");
    const info = await checkForUpdate();
    adapter.addLines([
      chalk.white(`  Current: v${info.currentVersion} | Latest: v${info.latestVersion}`),
      info.hasUpdate
        ? chalk.green("  Update available! Run /update again to apply.")
        : chalk.green("  ✓ Already up to date."),
    ]);
  } catch (err) {
    adapter.addLine(chalk.red(`  ✗ ${(err as Error).message}`));
  }
  return true;
}

function cmdCron(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const sub = parts[1];
  if (!sub || sub === "list") {
    const jobs = ctx.cronStore.list();
    if (jobs.length === 0) {
      adapter.addLine(chalk.gray("  No scheduled tasks. Usage: /cron add <cron> <prompt>"));
    } else {
      adapter.addLines([
        chalk.cyan("  Scheduled tasks:"),
        ...jobs.map(j => {
          const status = j.enabled ? chalk.green("on") : chalk.red("off");
          return `    ${chalk.white(j.id.slice(0, 12))} ${status} ${chalk.gray(j.schedule)} ${j.prompt.slice(0, 50)}`;
        }),
      ]);
    }
  } else if (sub === "add" && parts.length >= 4) {
    const job = ctx.cronStore.add({
      name: parts[2],
      schedule: { type: "cron", expression: parts[2] } as any,
      prompt: parts.slice(3).join(" "),
      enabled: true,
      delivery: ["cli"],
    });
    adapter.addLine(chalk.green(`  ✓ Cron job added: ${job.id}`));
  } else if (sub === "remove" && parts[2]) {
    const ok = ctx.cronStore.remove(parts[2]);
    adapter.addLine(ok ? chalk.green(`  ✓ Removed: ${parts[2]}`) : chalk.red("  ✗ Not found"));
  } else if (sub === "enable" && parts[2]) {
    ctx.cronStore.toggle(parts[2], true);
    adapter.addLine(chalk.green(`  ✓ Enabled: ${parts[2]}`));
  } else if (sub === "disable" && parts[2]) {
    ctx.cronStore.toggle(parts[2], false);
    adapter.addLine(chalk.green(`  ✓ Disabled: ${parts[2]}`));
  }
  return true;
}

function cmdStop(ctx: CommandContext, adapter: OutputAdapter): boolean {
  const agent = ctx.agent as any;
  const procs = agent["processRegistry"];
  if (!procs) {
    adapter.addLine(chalk.gray("  No process registry available."));
    return true;
  }
  const running = procs.list().filter((p: any) => p.status === "running");
  if (running.length === 0) {
    adapter.addLine(chalk.gray("  No running background processes."));
    return true;
  }
  for (const p of running) {
    procs.kill(p.id);
  }
  adapter.addLine(chalk.green(`  ✓ Stopped ${running.length} process(es)`));
  return true;
}

function cmdAgents(ctx: CommandContext, adapter: OutputAdapter): boolean {
  const agent = ctx.agent as any;
  const bgTasks = agent["bgTasks"];
  const procs = agent["processRegistry"];
  const lines: string[] = [chalk.cyan("  Active agents & tasks:")];

  const bgList = bgTasks?.list() ?? [];
  const running = bgList.filter((t: any) => t.status === "running");
  const completed = bgList.filter((t: any) => t.status === "completed");
  if (running.length > 0) {
    lines.push(chalk.yellow(`  Running (${running.length}):`));
    for (const t of running) lines.push(`    ${chalk.white(t.id)} ${t.command.slice(0, 60)}`);
  }
  if (completed.length > 0) {
    lines.push(chalk.green(`  Completed (${completed.length}):`));
    for (const t of completed.slice(-5)) lines.push(`    ${chalk.gray(t.id)} ${t.command.slice(0, 60)}`);
  }
  if (running.length === 0 && completed.length === 0) {
    lines.push(chalk.gray("  No active tasks."));
  }
  const goal = ctx.agent.getGoal();
  if (goal) {
    lines.push(`  Goal: ${chalk.white(goal.goal)} ${chalk.gray(`[${goal.status}]`)}`);
  }
  adapter.addLines(lines);
  return true;
}

function cmdQueue(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const text = parts.slice(1).join(" ");
  if (!text) {
    adapter.addLine(chalk.gray("  Usage: /queue <prompt>"));
    return true;
  }
  const agent = ctx.agent as any;
  if (!agent["pendingQueue"]) agent["pendingQueue"] = [];
  agent["pendingQueue"].push(text);
  adapter.addLine(chalk.green(`  ✓ Queued: ${text.slice(0, 80)}${text.length > 80 ? "..." : ""}`));
  return true;
}

function cmdSteer(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const text = parts.slice(1).join(" ");
  if (!text) {
    adapter.addLine(chalk.gray("  Usage: /steer <prompt>"));
    adapter.addLine(chalk.gray("  Injects a guidance message after next tool call without interrupting current turn."));
    return true;
  }
  ctx.agent.setSteerMessage(text);
  adapter.addLine(chalk.green(`  ✓ Steer queued — will inject after next tool call`));
  adapter.addLine(chalk.gray(`    "${text.slice(0, 80)}${text.length > 80 ? "..." : ""}"`));
  return true;
}

function cmdRollback(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const agent = ctx.agent as any;
  const checkpoints = agent["checkpoints"] ?? agent["checkpointManager"];
  if (!checkpoints) {
    adapter.addLine(chalk.gray("  Checkpoint system not available."));
    return true;
  }
  const sub = parts[1];
  if (!sub || sub === "list") {
    const list = checkpoints.list?.() ?? [];
    if (list.length === 0) {
      adapter.addLine(chalk.gray("  No checkpoints available."));
    } else {
      adapter.addLines([
        chalk.cyan("  Checkpoints:"),
        ...list.map((c: any, i: number) => `    ${chalk.white(`#${i}`)} ${chalk.gray(c.timestamp ?? c.name ?? "")}`),
      ]);
    }
  } else {
    const idx = parseInt(sub);
    if (isNaN(idx)) {
      adapter.addLine(chalk.gray("  Usage: /rollback [number]"));
    } else {
      const ok = checkpoints.restore?.(idx);
      adapter.addLine(ok ? chalk.green(`  ✓ Restored checkpoint #${idx}`) : chalk.red(`  ✗ Checkpoint #${idx} not found`));
    }
  }
  return true;
}

function cmdYolo(ctx: CommandContext, adapter: OutputAdapter): boolean {
  const agent = ctx.agent as any;
  const approval = agent["approvalSystem"];
  if (!approval) {
    adapter.addLine(chalk.gray("  Approval system not available."));
    return true;
  }
  const current = approval.yoloMode ?? false;
  approval.yoloMode = !current;
  adapter.addLines([
    approval.yoloMode
      ? chalk.yellow("  ⚠ YOLO mode ON — all dangerous command approvals skipped")
      : chalk.green("  ✓ YOLO mode OFF — approvals restored"),
  ]);
  return true;
}

function cmdReasoning(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const agent = ctx.agent as any;
  const levels = ["none", "low", "medium", "high"] as const;
  const sub = parts[1];

  if (!sub || sub === "status" || sub === "show") {
    const current = agent["reasoningEffort"] ?? agent["llmConfig"]?.reasoningEffort ?? "medium";
    adapter.addLines([
      chalk.cyan("  Reasoning effort:"),
      `    Current: ${chalk.white(current)}`,
      chalk.gray("    Levels: none | low | medium | high"),
    ]);
  } else if (sub === "hide") {
    agent["showReasoning"] = false;
    adapter.addLine(chalk.green("  ✓ Reasoning display hidden"));
  } else if (levels.includes(sub as typeof levels[number])) {
    if (agent["llmConfig"]) agent["llmConfig"].reasoningEffort = sub;
    agent["reasoningEffort"] = sub;
    adapter.addLine(chalk.green(`  ✓ Reasoning effort: ${sub}`));
  } else {
    adapter.addLine(chalk.gray(`  Usage: /reasoning [${levels.join("|")}|show|hide]`));
  }
  return true;
}

function cmdFast(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const agent = ctx.agent as any;
  const sub = parts[1];
  const current = agent["fastMode"] ?? false;

  if (!sub || sub === "status") {
    adapter.addLines([
      chalk.cyan("  Fast mode:"),
      `    Status: ${current ? chalk.yellow("ON") : chalk.green("OFF")}`,
      chalk.gray("    Usage: /fast [normal|fast|on|off]"),
    ]);
  } else if (sub === "fast" || sub === "on") {
    agent["fastMode"] = true;
    adapter.addLine(chalk.green("  ✓ Fast mode ON"));
  } else if (sub === "normal" || sub === "off") {
    agent["fastMode"] = false;
    adapter.addLine(chalk.green("  ✓ Fast mode OFF (normal)"));
  } else {
    adapter.addLine(chalk.gray("  Usage: /fast [normal|fast|on|off|status]"));
  }
  return true;
}

function cmdFooter(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const agent = ctx.agent as any;
  const sub = parts[1];
  const current = agent["showFooter"] ?? true;

  if (!sub || sub === "status") {
    adapter.addLines([
      chalk.cyan("  Runtime footer:"),
      `    Status: ${current ? chalk.green("ON") : chalk.gray("OFF")}`,
    ]);
  } else if (sub === "on") {
    agent["showFooter"] = true;
    adapter.addLine(chalk.green("  ✓ Footer ON"));
  } else if (sub === "off") {
    agent["showFooter"] = false;
    adapter.addLine(chalk.green("  ✓ Footer OFF"));
  } else {
    adapter.addLine(chalk.gray("  Usage: /footer [on|off|status]"));
  }
  return true;
}

function cmdIndicator(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const agent = ctx.agent as any;
  const styles = ["kaomoji", "emoji", "unicode", "ascii"] as const;
  const sub = parts[1];

  if (!sub) {
    const current = agent["indicatorStyle"] ?? "emoji";
    adapter.addLines([
      chalk.cyan("  Busy indicator:"),
      `    Current: ${chalk.white(current)}`,
      chalk.gray("    Styles: kaomoji | emoji | unicode | ascii"),
    ]);
  } else if (styles.includes(sub as typeof styles[number])) {
    agent["indicatorStyle"] = sub;
    adapter.addLine(chalk.green(`  ✓ Indicator style: ${sub}`));
  } else {
    adapter.addLine(chalk.gray("  Usage: /indicator [kaomoji|emoji|unicode|ascii]"));
  }
  return true;
}

function cmdBusy(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const agent = ctx.agent as any;
  const modes = ["queue", "steer", "interrupt"] as const;
  const sub = parts[1];

  if (!sub || sub === "status") {
    const current = agent["busyAction"] ?? "interrupt";
    adapter.addLines([
      chalk.cyan("  Busy action (Enter while working):"),
      `    Current: ${chalk.white(current)}`,
      chalk.gray("    Modes: queue | steer | interrupt"),
    ]);
  } else if (modes.includes(sub as typeof modes[number])) {
    agent["busyAction"] = sub;
    adapter.addLine(chalk.green(`  ✓ Busy action: ${sub}`));
  } else {
    adapter.addLine(chalk.gray("  Usage: /busy [queue|steer|interrupt|status]"));
  }
  return true;
}

function cmdToolsets(ctx: CommandContext, adapter: OutputAdapter): boolean {
  const registry = ctx.agent.getToolRegistry();
  const toolsets = (registry as any)["toolsets"] ?? {};
  const keys = Object.keys(toolsets);
  if (keys.length === 0) {
    adapter.addLine(chalk.gray("  No toolsets configured."));
    return true;
  }
  adapter.addLines([
    chalk.cyan("  Toolsets:"),
    ...keys.map(k => {
      const tools: string[] = toolsets[k]?.tools ?? [];
      return `    ${chalk.white(k)} ${chalk.gray(`(${tools.length} tools): ${tools.join(", ")}`)}`;
    }),
  ]);
  return true;
}

function cmdSkills(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const skillReg = ctx.agent.getSkillRegistry();
  const sub = parts[1];

  if (!sub || sub === "list" || sub === "browse") {
    const all = skillReg.list();
    if (all.length === 0) {
      adapter.addLine(chalk.gray("  No skills installed. Place skills in ~/.skeleton/skills/"));
    } else {
      adapter.addLines([
        chalk.cyan(`  Skills (${all.length}):`),
        ...all.map(s => `    ${chalk.white(`/${s.name}`)}${s.userInvocable ? chalk.green(" ⚡") : ""} — ${(s.description ?? "").slice(0, 70)}`),
      ]);
    }
  } else if (sub === "search" && parts[2]) {
    const query = parts.slice(2).join(" ").toLowerCase();
    const all = skillReg.list();
    const matches = all.filter(s => s.name.toLowerCase().includes(query) || (s.description ?? "").toLowerCase().includes(query));
    if (matches.length === 0) {
      adapter.addLine(chalk.gray(`  No skills matching "${query}"`));
    } else {
      adapter.addLines([
        chalk.cyan(`  Search results (${matches.length}):`),
        ...matches.map(s => `    ${chalk.white(`/${s.name}`)} — ${(s.description ?? "").slice(0, 70)}`),
      ]);
    }
  } else if (sub === "inspect" && parts[2]) {
    const skill = skillReg.get(parts[2]);
    if (skill) {
      adapter.addLines([
        chalk.cyan(`  Skill: ${skill.name}`),
        `    Description: ${skill.description ?? "(none)"}`,
        `    Invocable: ${skill.userInvocable ? "yes" : "no"}`,
      ]);
    } else {
      adapter.addLine(chalk.red(`  ✗ Skill "${parts[2]}" not found`));
    }
  } else {
    adapter.addLine(chalk.gray("  Usage: /skills [search|browse|inspect] [query|name]"));
  }
  return true;
}

function cmdReload(ctx: CommandContext, adapter: OutputAdapter): boolean {
  try {
    const { loadEnv } = require("../env.js") as typeof import("../env.js");
    loadEnv();
    adapter.addLine(chalk.green("  ✓ .env variables reloaded"));
  } catch (err) {
    adapter.addLine(chalk.red(`  ✗ Reload failed: ${(err as Error).message}`));
  }
  return true;
}

function cmdReloadMcp(ctx: CommandContext, adapter: OutputAdapter): boolean {
  const mcpHost = (ctx.agent as any)["mcpHost"];
  if (!mcpHost) {
    adapter.addLine(chalk.gray("  MCP host not available."));
    return true;
  }
  try {
    mcpHost.reload?.();
    adapter.addLine(chalk.green("  ✓ MCP servers reloaded from config"));
  } catch (err) {
    adapter.addLine(chalk.red(`  ✗ MCP reload failed: ${(err as Error).message}`));
  }
  return true;
}

function cmdMcp(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const sub = parts[1];
  const name = parts.slice(2).join(" ");
  const agent = ctx.agent;
  const mcpTools = agent.getMcpServerTools();

  if (!sub || sub === "list") {
    const entries = [...mcpTools.entries()] as [string, { toolNames: string[] }][];
    if (entries.length === 0) {
      adapter.addLine(chalk.gray("  No MCP servers connected."));
      adapter.addLine(chalk.gray("  Configure in skeleton.yaml under mcp_servers."));
      return true;
    }
    adapter.addLines([
      chalk.cyan("  Connected MCP servers:"),
      ...entries.map(([serverName, info]) => {
        const toolCount = (info as any).toolNames?.length ?? 0;
        return `    ${chalk.green("●")} ${chalk.white(serverName)}  ${chalk.gray(`${toolCount} tools`)}`;
      }),
      "",
      chalk.gray("  /mcp enable <name>    — connect a builtin server"),
      chalk.gray("  /mcp disable <name>   — disconnect a server"),
      chalk.gray("  /mcp reconnect <name> — restart a server"),
    ]);
    return true;
  }

  if (sub === "enable") {
    if (!name) {
      const { listBuiltinMcpServersByCategory } = require("../mcp/index.js") as typeof import("../mcp/index.js");
      const categories = listBuiltinMcpServersByCategory();
      adapter.addLines([
        chalk.cyan("  Available MCP servers:"),
        ...Object.entries(categories).flatMap(([cat, servers]) => [
          chalk.yellow(`  ${cat}:`),
          ...(servers as any[]).map((s: any) => `    ${chalk.gray("○")} ${s.name} — ${s.description ?? ""}`),
        ]),
      ]);
      return true;
    }
    // Use the mcp_manage tool's enableBuiltin logic (checks platform, env, command, OSV)
    adapter.addLine(chalk.yellow(`  ⏳ Enabling "${name}"...`));
    const { BUILTIN_MCP_SERVERS } = require("../mcp/servers.js") as { BUILTIN_MCP_SERVERS: any[] };
    const builtin = BUILTIN_MCP_SERVERS.find((s: any) => s.name === name);
    if (!builtin) {
      adapter.addLine(chalk.red(`  ✗ Unknown server "${name}". Use /mcp enable (no args) to see available.`));
      return true;
    }
    if (builtin.requiredEnv) {
      const missing = builtin.requiredEnv.filter((v: string) => !process.env[v]);
      if (missing.length > 0) {
        adapter.addLine(chalk.red(`  ✗ Missing env: ${missing.join(", ")}`));
        adapter.addLine(chalk.gray(`    Set these in ~/.skeleton/.env then retry.`));
        return true;
      }
    }
    const config = { ...builtin.config, env: { ...builtin.config.env } };
    agent.addMcpServer(name, config).then(({ added, warnings }) => {
      if (added.length > 0) adapter.addLine(chalk.green(`  ✓ Enabled "${name}" — ${added.length} tools`));
      if (warnings) for (const w of warnings) adapter.addLine(chalk.yellow(`    ⚠ ${w}`));
    }).catch((err: Error) => adapter.addLine(chalk.red(`  ✗ ${err.message}`)));
    return true;
  }

  if (sub === "disable") {
    if (!name) { adapter.addLine(chalk.gray("  Usage: /mcp disable <name>")); return true; }
    agent.removeMcpServer(name).then(() => {
      adapter.addLine(chalk.green(`  ✓ Disabled "${name}"`));
    }).catch((err: Error) => adapter.addLine(chalk.red(`  ✗ ${err.message}`)));
    return true;
  }

  if (sub === "reconnect") {
    if (!name) { adapter.addLine(chalk.gray("  Usage: /mcp reconnect <name>")); return true; }
    adapter.addLine(chalk.yellow(`  ⏳ Reconnecting "${name}"...`));
    const { BUILTIN_MCP_SERVERS } = require("../mcp/servers.js") as { BUILTIN_MCP_SERVERS: any[] };
    const builtin = BUILTIN_MCP_SERVERS.find((s: any) => s.name === name);
    const config = builtin ? { ...builtin.config, env: { ...builtin.config.env } } : { command: name };
    agent.removeMcpServer(name).then(() => agent.addMcpServer(name, config))
      .then(({ added }) => adapter.addLine(chalk.green(`  ✓ Reconnected "${name}" — ${added.length} tools`)))
      .catch((err: Error) => adapter.addLine(chalk.red(`  ✗ ${err.message}`)));
    return true;
  }

  adapter.addLine(chalk.gray("  Usage: /mcp [list|enable|disable|reconnect] [name]"));
  return true;
}

function cmdReloadSkills(ctx: CommandContext, adapter: OutputAdapter): boolean {
  const skillReg = ctx.agent.getSkillRegistry();
  const before = new Set(skillReg.list().map(s => s.name));
  try {
    skillReg.loadFromDisk();
    const after = skillReg.list();
    const afterNames = new Set(after.map(s => s.name));
    const added = [...afterNames].filter(n => !before.has(n));
    const removed = [...before].filter(n => !afterNames.has(n));

    const lines = [chalk.green(`  ✓ Skills reloaded — ${after.length} skill(s) found`)];
    if (added.length > 0) lines.push(chalk.green(`    + Added: ${added.join(", ")}`));
    if (removed.length > 0) lines.push(chalk.red(`    - Removed: ${removed.join(", ")}`));
    if (added.length === 0 && removed.length === 0) lines.push(chalk.gray("    No changes."));
    adapter.addLines(lines);
  } catch (err) {
    adapter.addLine(chalk.red(`  ✗ Skills reload failed: ${(err as Error).message}`));
  }
  return true;
}

function cmdBrowser(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const sub = parts[1];
  // Lazy-import to avoid bundling ws when not needed
  const { cdpSupervisor } = require("../tools/browser-supervisor.js") as typeof import("../tools/browser-supervisor.js");

  if (!sub || sub === "status") {
    const connected = cdpSupervisor.isConnected();
    const backend = process.env.SKELETON_BROWSER_BACKEND ?? "playwright";
    const dialogs = cdpSupervisor.getPendingDialogs();
    adapter.addLines([
      chalk.cyan("  Browser:"),
      `    Backend: ${chalk.white(backend)}`,
      `    CDP: ${connected ? chalk.green("connected") + " " + cdpSupervisor.getWsUrl() : chalk.gray("disconnected")}`,
      ...(dialogs.length > 0 ? [chalk.yellow(`    Pending dialogs: ${dialogs.length}`)] : []),
      chalk.gray("    Usage: /browser [connect <url>|disconnect|status]"),
    ]);
  } else if (sub === "connect") {
    const wsUrl = parts[2];
    const doConnect = (url: string) => {
      cdpSupervisor.connect(url)
        .then(() => {
          process.env.SKELETON_BROWSER_BACKEND = "cdp";
          process.env.SKELETON_CDP_WS_URL = url;
          adapter.addLine(chalk.green(`  ✓ Connected to ${url}`));
        })
        .catch((err: Error) => {
          adapter.addLine(chalk.red(`  ✗ Connection failed: ${err.message}`));
        });
    };

    if (!wsUrl) {
      // Auto-discover: try existing CDP URL or localhost discovery
      const envUrl = process.env.SKELETON_CDP_WS_URL;
      if (envUrl) {
        doConnect(envUrl);
      } else {
        // Try localhost discovery, then Chrome auto-launch
        const { discoverCdpUrl, launchChrome, manualChromeCommand } = require("../tools/browser-connect.js") as typeof import("../tools/browser-connect.js");
        adapter.addLine(chalk.gray("  Discovering CDP endpoint on localhost:9222..."));
        discoverCdpUrl(9222).then((discovered: string | null) => {
          if (discovered) {
            adapter.addLine(chalk.green(`  ✓ Found CDP at ${discovered}`));
            doConnect(discovered);
          } else {
            adapter.addLine(chalk.gray("  No running CDP found. Attempting to launch Chrome..."));
            launchChrome().then((result: { cdpUrl: string }) => {
              adapter.addLine(chalk.green(`  ✓ Chrome launched, CDP at ${result.cdpUrl}`));
              doConnect(result.cdpUrl);
            }).catch(() => {
              const cmd = manualChromeCommand();
              adapter.addLines([
                chalk.yellow("  ✗ Could not auto-launch Chrome."),
                ...(cmd ? [chalk.gray(`  Run manually: ${cmd}`)] : []),
                chalk.gray("  Then: /browser connect ws://127.0.0.1:9222/devtools/page/XXX"),
              ]);
            });
          }
        });
      }
    } else {
      doConnect(wsUrl);
    }
  } else if (sub === "disconnect") {
    cdpSupervisor.disconnect();
    delete process.env.SKELETON_BROWSER_BACKEND;
    delete process.env.SKELETON_CDP_WS_URL;
    adapter.addLine(chalk.green("  ✓ Browser disconnected, reverted to playwright backend"));
  }
  return true;
}

function cmdImage(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const path = parts[1];
  if (!path) {
    adapter.addLine(chalk.gray("  Usage: /image <path>"));
    return true;
  }
  const agent = ctx.agent as any;
  agent["pendingImage"] = path;
  adapter.addLine(chalk.green(`  ✓ Image attached: ${path} — will be included in your next prompt`));
  return true;
}

function cmdKanban(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const sub = parts[1];
  const agent = ctx.agent as any;
  const kanban = agent["kanbanBoard"];

  if (!kanban) {
    adapter.addLine(chalk.gray("  Kanban board not available."));
    return true;
  }

  if (!sub || sub === "list") {
    const cards = kanban.list?.() ?? [];
    if (cards.length === 0) {
      adapter.addLine(chalk.gray("  No kanban cards. Usage: /kanban create <title>"));
    } else {
      adapter.addLines([
        chalk.cyan("  Kanban board:"),
        ...cards.map((c: any) => `    ${chalk.white(`#${c.id}`)} ${c.title} ${chalk.gray(`[${c.status}]`)}`),
      ]);
    }
  } else if (sub === "create" && parts[2]) {
    const title = parts.slice(2).join(" ");
    const card = kanban.create?.(title);
    adapter.addLine(chalk.green(`  ✓ Card created: ${title}`));
  } else if (sub === "complete" && parts[2]) {
    kanban.complete?.(parts[2]);
    adapter.addLine(chalk.green(`  ✓ Card ${parts[2]} completed`));
  } else if (sub === "block" && parts[2]) {
    kanban.block?.(parts[2], parts[3] ?? "");
    adapter.addLine(chalk.yellow(`  ⚠ Card ${parts[2]} blocked`));
  } else if (sub === "comment" && parts[2]) {
    kanban.comment?.(parts[2], parts.slice(3).join(" "));
    adapter.addLine(chalk.green(`  ✓ Comment added to card ${parts[2]}`));
  } else {
    adapter.addLine(chalk.gray("  Usage: /kanban [list|create|complete|block|comment]"));
  }
  return true;
}

function cmdTrajectory(ctx: CommandContext, adapter: OutputAdapter): boolean {
  const { TrajectoryCompressor } = require("../trajectory-compressor.js") as typeof import("../trajectory-compressor.js");
  const compressor = new TrajectoryCompressor();
  const messages = ctx.agent.getHistory().map(m => ({ role: m.role as "user" | "assistant" | "tool", content: m.content ?? "" }));
  const result = compressor.compress(messages);
  adapter.addLines([
    chalk.cyan("  Trajectory compression:"),
    `    Original: ${result.originalLength.toLocaleString()} chars`,
    `    Compressed: ${result.compressedLength.toLocaleString()} chars`,
    `    Ratio: ${(result.compressionRatio * 100).toFixed(1)}%`,
    `    Key turns: ${result.messages.filter(m => m.isKeyTurn).length}/${result.messages.length}`,
  ]);
  return true;
}

function cmdSandbox(ctx: CommandContext, adapter: OutputAdapter, parts: string[]): boolean {
  const sub = parts[1]?.toLowerCase();

  if (!sub || sub === "status") {
    const current = process.env.SKELETON_SANDBOX ?? "local";

    adapter.addLines([
      chalk.cyan("  Sandbox status:"),
      `    Backend: ${chalk.bold(current)}`,
      `    Docker image: ${process.env.SKELETON_DOCKER_IMAGE ?? "ubuntu:22.04"}`,
      `    SSH host: ${process.env.SKELETON_SSH_HOST ?? "(not set)"}`,
    ]);
    return true;
  }

  if (sub === "local") {
    process.env.SKELETON_SANDBOX = "local";
    adapter.addLine(chalk.green("  ✓ Switched to local sandbox"));
    return true;
  }

  if (sub === "docker") {
    const image = parts[2];
    if (image) process.env.SKELETON_DOCKER_IMAGE = image;
    process.env.SKELETON_SANDBOX = "docker";
    adapter.addLine(chalk.green(`  ✓ Switched to docker sandbox${image ? ` (image: ${image})` : ""}`));
    return true;
  }

  if (sub === "ssh") {
    const host = parts[2];
    const user = parts[3];
    if (!host) {
      adapter.addLine(chalk.red("  ✗ Usage: /sandbox ssh <host> [user]"));
      return true;
    }
    process.env.SKELETON_SSH_HOST = host;
    if (user) process.env.SKELETON_SSH_USER = user;
    process.env.SKELETON_SANDBOX = "ssh";
    adapter.addLine(chalk.green(`  ✓ Switched to ssh sandbox (${user ?? "root"}@${host})`));
    return true;
  }

  if (sub === "stop" || sub === "cleanup") {
    const { cleanupSandboxes } = require("../sandbox.js") as typeof import("../sandbox.js");
    cleanupSandboxes().then(() => {
      adapter.addLine(chalk.green("  ✓ All sandbox resources cleaned up"));
    }).catch((err: Error) => {
      adapter.addLine(chalk.red(`  ✗ Cleanup failed: ${err.message}`));
    });
    return true;
  }

  adapter.addLines([
    chalk.yellow("  Usage: /sandbox [status|local|docker [image]|ssh <host> [user]|stop]"),
  ]);
  return true;
}
