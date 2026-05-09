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

    case "compress":
      adapter.addLine(chalk.gray("  Compressing..."));
      try {
        const msg = await ctx.agent.compress();
        adapter.addLine(chalk.green(`  ✓ ${msg}`));
      } catch (err) {
        adapter.addLine(chalk.red(`  ✗ ${(err as Error).message}`));
      }
      return true;

    case "branch":
      return cmdBranch(ctx, adapter, parts);

    case "resume":
      return cmdResume(ctx, adapter, parts);

    case "snapshot":
      return cmdSnapshot(ctx, adapter, parts);

    case "goal":
      return cmdGoal(ctx, adapter, parts);

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

    case "mcp":
      adapter.addLine(chalk.gray("  Use /tools to see available tools including MCP-provided ones."));
      return true;

    case "curator":
      return cmdCurator(ctx, adapter);

    case "plugin":
      return cmdPlugin(ctx, adapter, parts);

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
    const branches = ctx.agent.listBranches();
    adapter.addLines([
      chalk.gray("  Usage: /resume <branch-name>"),
      ...(branches.length > 0 ? [chalk.gray(`  Available: ${branches.join(", ")}`)] : []),
    ]);
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
