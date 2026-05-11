import { Bot } from "grammy";
import {
  Agent, loadConfig, loadTools, Logger,
  MemoryStore, SessionDB, UserProfile, ProjectContext,
  CronStore, CronScheduler, HonchoUserModel,
  listBuiltinMcpServersByCategory, MCP_CATEGORIES,
  markdownToMDv2, escapeMDv2, filterThinkBlocks,
  chunkForTelegram, convertTablesToMDv2,
  applyGlobalProxy,
  readSimpleConfig,
} from "@skeleton/core";

applyGlobalProxy().catch(() => { /* non-critical */ });
const log = new Logger("tg");

const simpleConfig = readSimpleConfig();
const TOKEN = simpleConfig?.telegramToken ?? process.env.SKELETON_TG_TOKEN ?? "";
if (!TOKEN) {
  console.error("Set telegramToken in ~/.skeleton/config.json");
  process.exit(1);
}

const config = loadConfig();
if (!config.llm.apiKey) {
  console.error("Create ~/.skeleton/config.json with baseUrl, apiKey, model");
  process.exit(1);
}

// ─── Access control config ───

type GroupMode = "off" | "mention" | "all";

const ALLOWED_USERS = parseAllowedUsers(process.env.SKELETON_TG_ALLOWED_USERS ?? "*");
const GROUP_MODE: GroupMode = (process.env.SKELETON_TG_GROUP_MODE as GroupMode) ?? "mention";
const REACTIONS = (process.env.SKELETON_TG_REACTIONS ?? "true").toLowerCase() !== "false";
const REPLY_MODE: "off" | "first" | "all" = (process.env.SKELETON_TG_REPLY_MODE as "off" | "first" | "all") ?? "first";

function parseAllowedUsers(raw: string): Set<number> | null {
  if (raw === "*" || raw === "") return null;
  const ids = raw.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0);
  return ids.length > 0 ? new Set(ids) : null;
}

function isUserAllowed(userId: number): boolean {
  if (ALLOWED_USERS === null) return true;
  return ALLOWED_USERS.has(userId);
}

// ─── Initialize stores ───

const sessionDb = new SessionDB();
const memory = new MemoryStore();
const userProfile = new UserProfile();
const cronStore = new CronStore();
const projectContext = new ProjectContext();
const honcho = new HonchoUserModel();

// ─── Tool loading (async) ───

let loadedTools: import("@skeleton/core").ToolDef[] = [];
let mcpClients: unknown[] = [];
let mcpServerToolMap: Record<string, { toolNames: string[]; client: unknown }> = {};

async function initTools() {
  const result = await loadTools(config as any, memory, userProfile, cronStore);
  loadedTools = result.tools;
  mcpClients = result.mcpClients;
  mcpServerToolMap = result.mcpServerToolMap;
  console.log(`   Tools: ${loadedTools.length} (${loadedTools.map(t => t.name).join(", ")})`);
  log.info("Tools loaded", { count: loadedTools.length });
}

initTools().catch(err => {
  console.error("Failed to load tools:", err);
  log.error("Tool loading failed", { error: (err as Error).message });
});

// Cron scheduler
const cronScheduler = new CronScheduler(cronStore, async (job) => {
  // noAgent mode: execute command directly without LLM
  if (job.noAgent && job.command) {
    const { execSync } = await import("node:child_process");
    try {
      const output = execSync(job.command, { timeout: 30_000, encoding: "utf-8" });
      return output.slice(0, 2000);
    } catch (err) {
      return `Command failed: ${(err as Error).message}`;
    }
  }

  const agent = new Agent(
    { ...config, tools: loadedTools },
    memory, userProfile, cronStore, sessionDb, projectContext, honcho,
  );
  agent.setMcpClients(mcpClients, mcpServerToolMap);
  const result = await agent.run(job.prompt);
  // Don't close shared MCP connections — other per-user agents still need them
  await agent.close({ closeMcp: false });

  // Deliver to Telegram if configured and not silent
  if (!job.silent && job.delivery.includes("telegram")) {
    for (const [userId, state] of users) {
      try {
        await bot.api.sendMessage(userId, `⏰ [${job.name}] ${result.slice(0, 4000)}`);
      } catch { /* ignore */ }
      break;
    }
  }

  // Webhook delivery
  if (!job.silent && job.delivery.includes("webhook") && job.webhookUrl) {
    try {
      await fetch(job.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job: job.name, result: result.slice(0, 4000), timestamp: new Date().toISOString() }),
      });
    } catch { /* ignore webhook failures */ }
  }

  return result;
});
cronScheduler.start();

// Per-user state
interface UserState {
  agent: Agent;
  sessionId: string;
  lock: Promise<void>;
  lastActive: number;
}
const users = new Map<number, UserState>();

const USER_IDLE_MS = 30 * 60 * 1000; // 30 minutes

// Periodic cleanup of idle user agents
setInterval(() => {
  const now = Date.now();
  for (const [userId, state] of users) {
    if (now - state.lastActive > USER_IDLE_MS) {
      state.agent.close().catch(() => {});
      users.delete(userId);
    }
  }
}, 5 * 60 * 1000); // every 5 minutes

const bot = new Bot(TOKEN);

console.log(`🔓 Skeleton TG gateway`);
console.log(`   Protocol: ${config.llm.protocol} | Model: ${config.llm.model} | Base: ${config.llm.baseUrl}`);
console.log(`   Allowed users: ${ALLOWED_USERS === null ? "*" : [...ALLOWED_USERS].join(", ")}`);
console.log(`   Group mode: ${GROUP_MODE} (off / mention / all)`);
console.log(`   MCP servers: ${loadedTools.length} tools, ${mcpClients.length} clients`);
log.info("TG gateway started", { protocol: config.llm.protocol, model: config.llm.model, groupMode: GROUP_MODE, mcpClients: mcpClients.length });

// ─── Access control middleware ───

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  if (ctx.chat?.type === "private") {
    if (!isUserAllowed(userId)) {
      console.log(`   ⛔ DM rejected: user ${userId}`);
      log.warn("DM rejected", { userId });
      return;
    }
    return next();
  }

  if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
    if (GROUP_MODE === "off") return;
    if (ctx.message?.text?.startsWith("/")) {
      if (!isUserAllowed(userId)) return;
      return next();
    }
    if (GROUP_MODE === "all") {
      if (!isUserAllowed(userId)) return;
      return next();
    }
    const botInfo = bot.botInfo;
    const text = ctx.message?.text ?? "";
    const mentionStr = `@${botInfo.username}`;
    const isMentioned = text.includes(mentionStr);
    if (isMentioned) {
      if (!isUserAllowed(userId)) return;
      if (ctx.message) {
        ctx.message.text = text.replace(mentionStr, "").trim();
      }
      return next();
    }
    return;
  }

  return next();
});

function getState(userId: number): UserState {
  let state = users.get(userId);
  if (!state) {
    const agentConfig = { ...config, tools: loadedTools };
    state = {
      agent: new Agent(agentConfig, memory, userProfile, cronStore, sessionDb, projectContext, honcho),
      sessionId: `tg_${userId}_${Date.now()}`,
      lock: Promise.resolve(),
      lastActive: Date.now(),
    };
    state.agent.setMcpClients(mcpClients);
    sessionDb.createSession(state.sessionId, `Telegram ${userId}`);

    // Wire approval callback: send inline keyboard buttons to Telegram
    const capturedUserId = userId;
    state.agent.getApprovalSystem().onApprovalRequest(async (toolName, args, reason) => {
      return await requestTelegramApproval(capturedUserId, toolName, args, reason);
    });

    users.set(userId, state);
  } else {
    state.lastActive = Date.now();
  }
  return state;
}

// ─── Telegram Approval via Inline Keyboard ───

const pendingApprovals = new Map<string, { resolve: (approved: boolean) => void; timer: NodeJS.Timeout }>();

async function requestTelegramApproval(
  userId: number,
  toolName: string,
  args: Record<string, unknown>,
  reason: string,
): Promise<boolean> {
  const approvalId = `appr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  const preview = `${toolName}: ${JSON.stringify(args).slice(0, 200)}`;

  try {
    await bot.api.sendMessage(userId, `⚠️ *Approval Required*\n\nTool: \`${escapeMDv2(toolName)}\`\nReason: ${escapeMDv2(reason)}\n\n\`\`\`\n${escapeMDv2(preview)}\n\`\`\``, {
      parse_mode: "MarkdownV2",
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Approve", callback_data: `approve:${approvalId}` },
          { text: "❌ Deny", callback_data: `deny:${approvalId}` },
        ]],
      },
    });
  } catch {
    return true; // fallback: auto-approve if message fails
  }

  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      pendingApprovals.delete(approvalId);
      resolve(true); // timeout = auto-approve (fail-open for usability)
    }, 60_000);
    pendingApprovals.set(approvalId, { resolve, timer });
  });
}

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (!data) return;

  const [action, approvalId] = data.split(":");
  if (!approvalId || (action !== "approve" && action !== "deny")) return;

  const pending = pendingApprovals.get(approvalId);
  if (!pending) {
    await ctx.answerCallbackQuery({ text: "Expired or already handled" });
    return;
  }

  clearTimeout(pending.timer);
  pendingApprovals.delete(approvalId);
  pending.resolve(action === "approve");

  const emoji = action === "approve" ? "✅" : "❌";
  await ctx.answerCallbackQuery({ text: `${emoji} ${action === "approve" ? "Approved" : "Denied"}` });

  try {
    await ctx.editMessageReplyMarkup({ reply_markup: { inline_keyboard: [] } });
  } catch { /* message might be too old */ }
});

// ─── MarkdownV2 helpers ───

function formatResponseMDv2(text: string): string {
  const filtered = filterThinkBlocks(text);
  const noTables = convertTablesToMDv2(filtered);
  return markdownToMDv2(noTables);
}

function escapeMD(text: string): string {
  return escapeMDv2(text);
}

function truncateMD(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit - 3) + "…";
}

// ─── Streaming via editMessage ───

const STREAM_CURSOR = " ▉";
const EDIT_INTERVAL_MS = 2500;
const BUFFER_THRESHOLD = 40;
const MAX_MSG_LEN = 4000;
const MAX_FLOOD_STRIKES = 3;

async function streamToChat(
  chatId: number,
  userId: number,
  text: string,
  replyToMsgId?: number,
): Promise<string> {
  const state = getState(userId);
  let accumulated = "";
  let streamDone = false;
  let streamResult = "";

  const onToken = (token: string) => {
    const filtered = filterThinkBlocks(token);
    if (filtered) accumulated += filtered;
  };

  const streamPromise = state.agent.runStream(text, onToken).then(r => {
    streamResult = r;
    streamDone = true;
    return r;
  });

  let msgId: number | undefined;
  let lastSentText = "";
  let lastEditLen = 0;
  let editSupported = true;
  let floodStrikes = 0;
  let currentInterval = EDIT_INTERVAL_MS;
  let fallbackPrefix = "";

  while (!msgId && !streamDone) {
    if (accumulated.length >= 4) {
      const msg = await bot.api.sendMessage(chatId, accumulated + STREAM_CURSOR);
      msgId = msg.message_id;
      lastSentText = accumulated + STREAM_CURSOR;
      lastEditLen = accumulated.length;
    } else {
      await new Promise(r => setTimeout(r, 300));
    }
  }

  if (!msgId) {
    return await streamPromise;
  }

  while (!streamDone) {
    await new Promise(r => setTimeout(r, currentInterval));
    if (!editSupported) continue;
    const newChars = accumulated.length - lastEditLen;
    if (newChars < BUFFER_THRESHOLD) continue;
    const displayText = truncateMD(accumulated, MAX_MSG_LEN) + STREAM_CURSOR;
    if (displayText === lastSentText) continue;
    lastEditLen = accumulated.length;
    try {
      await bot.api.editMessageText(chatId, msgId!, displayText);
      lastSentText = displayText;
      floodStrikes = 0;
      currentInterval = EDIT_INTERVAL_MS;
    } catch (err: unknown) {
      const desc = ((err as Error)?.message ?? "").toLowerCase();
      if (desc.includes("not modified")) continue;
      if (desc.includes("flood") || desc.includes("retry after") || desc.includes("too many")) {
        floodStrikes++;
        currentInterval = Math.min(currentInterval * 2, 10000);
        if (floodStrikes >= MAX_FLOOD_STRIKES) {
          editSupported = false;
          fallbackPrefix = lastSentText.replace(STREAM_CURSOR, "");
          log.warn("Flood control: entering fallback mode", { userId, floodStrikes });
        }
        continue;
      }
      editSupported = false;
      fallbackPrefix = lastSentText.replace(STREAM_CURSOR, "");
      log.warn("Edit failed: entering fallback mode", { userId, error: desc });
    }
  }

  const result = await streamPromise;

  // Apply MarkdownV2 formatting with think-block filtering and table conversion
  const formatted = formatResponseMDv2(result);

  if (editSupported && msgId) {
    // Multi-chunk delivery: first chunk edits the streaming message, rest are new messages
    const chunks = chunkForTelegram(formatted, MAX_MSG_LEN);
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      try {
        if (ci === 0) {
          await bot.api.editMessageText(chatId, msgId, chunk, { parse_mode: "MarkdownV2" });
        } else {
          const replyOpts = REPLY_MODE === "all" && replyToMsgId ? { reply_parameters: { message_id: replyToMsgId } } : {};
          await bot.api.sendMessage(chatId, chunk, { parse_mode: "MarkdownV2", ...replyOpts });
        }
      } catch {
        // MarkdownV2 parse failed — fallback to plain text
        try {
          const plainChunk = chunk.replace(/\\([_*\[\]()~`>#\+=|{}.!\\-])/g, "$1");
          if (ci === 0) {
            await bot.api.editMessageText(chatId, msgId, plainChunk);
          } else {
            await bot.api.sendMessage(chatId, plainChunk);
          }
        } catch { /* ignore */ }
      }
    }
  } else if (fallbackPrefix) {
    const continuation = result.slice(fallbackPrefix.length);
    if (continuation.trim()) {
      try {
        const contFormatted = formatResponseMDv2(continuation);
        const chunks = chunkForTelegram(contFormatted, MAX_MSG_LEN);
        for (const chunk of chunks) {
          try {
            await bot.api.sendMessage(chatId, chunk, { parse_mode: "MarkdownV2" });
          } catch {
            const plain = chunk.replace(/\\([_*\[\]()~`>#\+=|{}.!\\-])/g, "$1");
            await bot.api.sendMessage(chatId, plain);
          }
        }
      } catch { /* ignore */ }
    }
    try { await bot.api.editMessageText(chatId, msgId!, fallbackPrefix); } catch { /* ignore */ }
  } else if (msgId) {
    const chunks = chunkForTelegram(formatted, MAX_MSG_LEN);
    for (let ci = 0; ci < chunks.length; ci++) {
      const chunk = chunks[ci];
      try {
        const replyOpts = ci === 0 && REPLY_MODE !== "off" && replyToMsgId ? { reply_parameters: { message_id: replyToMsgId } } : {};
        await bot.api.sendMessage(chatId, chunk, { parse_mode: "MarkdownV2", ...replyOpts });
      } catch {
        const plain = chunk.replace(/\\([_*\[\]()~`>#\+=|{}.!\\-])/g, "$1");
        await bot.api.sendMessage(chatId, plain);
      }
    }
  }

  return result;
}

function formatResponse(text: string): string {
  return formatResponseMDv2(text);
}

// ─── Concurrency ───

function withLock(userId: number, fn: () => Promise<void>): void {
  const state = getState(userId);
  const prev = state.lock;
  state.lock = prev.then(fn, fn);
}

// ─── Typing indicator ───

function keepTyping(chatId: number, stop: { done: boolean }): NodeJS.Timeout {
  const iv = setInterval(() => {
    if (stop.done) { clearInterval(iv); return; }
    bot.api.sendChatAction(chatId, "typing").catch(() => {});
  }, 3000);
  return iv;
}

// ─── Message reactions ───

async function setReaction(chatId: number, messageId: number, emoji: string): Promise<void> {
  if (!REACTIONS) return;
  try {
    await bot.api.setMessageReaction(chatId, messageId, [{ type: "emoji", emoji }]);
  } catch { /* ignore */ }
}

// ─── Commands ───

bot.command("start", async (ctx) => {
  await ctx.reply(
    "🔓 *Skeleton — Reverse Engineering Agent*\n\n" +
      "I learn from every conversation and get smarter over time\\.\n\n" +
      "/new — New session \\(memories kept\\)\n" +
      "/reset — Clear conversation\n" +
      "/history — View history\n" +
      "/model — Show current model\n" +
      "/memory — View saved memories\n" +
      "/remember \\[text\\] — Save a memory\n" +
      "/forget \\[keyword\\] — Delete memories\n" +
      "/search \\[query\\] — Search past conversations\n" +
      "/tools — List tools\n" +
      "/mcp — List MCP servers\n" +
      "/cron — List scheduled tasks",
    { parse_mode: "MarkdownV2" },
  );
});

bot.command("new", async (ctx) => {
  const userId = ctx.from!.id;
  const state = getState(userId);
  const agentConfig = { ...config, tools: loadedTools };
  state.agent = new Agent(agentConfig, memory, userProfile, cronStore, sessionDb, projectContext, honcho);
  state.agent.setMcpClients(mcpClients);
  state.sessionId = `tg_${userId}_${Date.now()}`;
  sessionDb.createSession(state.sessionId, `Telegram ${userId}`);
  await ctx.reply("🆕 New session\\. Memories preserved\\.", { parse_mode: "MarkdownV2" });
});

bot.command("reset", async (ctx) => {
  const userId = ctx.from!.id;
  const state = getState(userId);
  state.agent.reset();
  await ctx.reply("🔄 Conversation reset\\.", { parse_mode: "MarkdownV2" });
});

bot.command("history", async (ctx) => {
  const agent = getState(ctx.from!.id).agent;
  const history = agent.getHistory();
  if (history.length === 0) {
    await ctx.reply("No messages yet\\.", { parse_mode: "MarkdownV2" });
    return;
  }
  const preview = history
    .slice(-10)
    .map((m) => `[${m.role}] ${escapeMD(m.content.slice(0, 100))}`)
    .join("\n");
  await ctx.reply(`📝 Last 10:\n\n${preview}`, { parse_mode: "MarkdownV2" });
});

bot.command("model", async (ctx) => {
  const state = getState(ctx.from!.id);
  const { llm } = config;
  await ctx.reply(
    `🔧 ${escapeMD(llm.protocol)} | ${escapeMD(llm.model)}\nBase: ${escapeMD(llm.baseUrl)}\nSession: ${escapeMD(state.sessionId)}`,
    { parse_mode: "MarkdownV2" },
  );
});

bot.command("memory", async (ctx) => {
  const all = memory.list();
  if (all.length === 0) {
    await ctx.reply("No memories yet\\.", { parse_mode: "MarkdownV2" });
    return;
  }
  const preview = all
    .slice(0, 20)
    .map((m) => `[${escapeMD(m.category)}] ${escapeMD(m.content.slice(0, 80))} \\(used ${m.useCount}x\\)`)
    .join("\n");
  await ctx.reply(`🧠 Memories:\n\n${preview}`, { parse_mode: "MarkdownV2" });
});

bot.command("remember", async (ctx) => {
  const text = ctx.message?.text?.slice("/remember".length).trim();
  if (!text) {
    await ctx.reply("Usage: /remember \\[something to remember\\]", { parse_mode: "MarkdownV2" });
    return;
  }
  memory.add(text, "user", "manual");
  await ctx.reply("💾 Saved\\.", { parse_mode: "MarkdownV2" });
});

bot.command("forget", async (ctx) => {
  const keyword = ctx.message?.text?.slice("/forget".length).trim();
  if (!keyword) {
    await ctx.reply("Usage: /forget \\[keyword\\]", { parse_mode: "MarkdownV2" });
    return;
  }
  const removed = memory.remove(keyword);
  await ctx.reply(`✓ Removed ${removed} memory\\(ies\\)\\.`, { parse_mode: "MarkdownV2" });
});

bot.command("search", async (ctx) => {
  const query = ctx.message?.text?.slice("/search".length).trim();
  if (!query) {
    await ctx.reply("Usage: /search \\[query\\]", { parse_mode: "MarkdownV2" });
    return;
  }
  const results = sessionDb.search(query);
  if (results.length === 0) {
    await ctx.reply("No results\\.", { parse_mode: "MarkdownV2" });
    return;
  }
  const preview = results
    .slice(0, 10)
    .map((r) => `[${r.role}] ${escapeMD(r.content.slice(0, 80))}`)
    .join("\n");
  await ctx.reply(`🔍 Results:\n\n${preview}`, { parse_mode: "MarkdownV2" });
});

bot.command("tools", async (ctx) => {
  const toolList = loadedTools;
  if (toolList.length === 0) {
    await ctx.reply("No tools registered\\.", { parse_mode: "MarkdownV2" });
    return;
  }
  const preview = toolList
    .slice(0, 20)
    .map((t) => `🔧 ${escapeMD(t.name)} — ${escapeMD(t.description.slice(0, 60))}`)
    .join("\n");
  await ctx.reply(`Tools \\(${toolList.length}\\):\n\n${preview}`, { parse_mode: "MarkdownV2" });
});

bot.command("mcp", async (ctx) => {
  const byCategory = listBuiltinMcpServersByCategory();
  const lines: string[] = [];
  for (const [category, servers] of Object.entries(byCategory)) {
    lines.push(`\\[${escapeMD(category)}\\]`);
    for (const s of servers.slice(0, 5)) {
      const plat = s.platform ? ` \\(${s.platform.join("\\/")}\\)` : "";
      const reqs = s.requiredEnv?.length ? ` \\[needs: ${s.requiredEnv.join(", ")}\\]` : "";
      lines.push(`  ${escapeMD(s.name)}${plat} — ${escapeMD(s.envEnable)}\\=true${reqs}`);
    }
    if (servers.length > 5) lines.push(`  \\+${servers.length - 5} more`);
  }
  lines.push("\\nEnable: /mcp enable <name> or SKELETON\\_MCP\\_<NAME>\\=true");
  await ctx.reply(lines.join("\n"), { parse_mode: "MarkdownV2" });
});

bot.command("cron", async (ctx) => {
  const jobs = cronStore.list();
  if (jobs.length === 0) {
    await ctx.reply("No scheduled tasks\\.", { parse_mode: "MarkdownV2" });
    return;
  }
  const preview = jobs
    .map((j) => {
      const s = j.enabled ? "●" : "○";
      return `${s} ${escapeMD(j.name)} \\(${j.runCount} runs\\)`;
    })
    .join("\n");
  await ctx.reply(`⏰ Cron tasks:\n\n${preview}`, { parse_mode: "MarkdownV2" });
});

bot.command("compress", async (ctx) => {
  const agent = getState(ctx.from!.id).agent;
  try {
    const msg = await agent.compress();
    await ctx.reply(`🗜 ${escapeMD(msg)}`, { parse_mode: "MarkdownV2" });
  } catch (err) {
    await ctx.reply(`❌ Compression failed: ${escapeMD((err as Error).message)}`, { parse_mode: "MarkdownV2" });
  }
});

bot.command("undo", async (ctx) => {
  const agent = getState(ctx.from!.id).agent;
  const ok = agent.undoLastTurn();
  await ctx.reply(ok ? "↩ Last turn undone\\." : "Nothing to undo\\.", { parse_mode: "MarkdownV2" });
});

bot.command("retry", async (ctx) => {
  const userId = ctx.from!.id;
  const agent = getState(userId).agent;
  const lastInput = agent.getLastUserInput();
  if (!lastInput) {
    await ctx.reply("No previous input to retry\\.", { parse_mode: "MarkdownV2" });
    return;
  }
  agent.undoLastTurn();
  const chatId = ctx.chat.id;
  withLock(userId, async () => {
    const typingStop = { done: false };
    const typingTimer = keepTyping(chatId, typingStop);
    try {
      const result = await streamToChat(chatId, userId, lastInput, REPLY_MODE !== "off" ? ctx.message?.message_id : undefined);
      log.info("Retry completed", { userId, inputLen: lastInput.length, outputLen: result.length });
    } catch (err) {
      log.error("Retry failed", { userId, error: (err as Error).message });
      await ctx.reply(`❌ ${(err as Error).message}`).catch(() => {});
    } finally {
      typingStop.done = true;
      clearInterval(typingTimer);
    }
  });
});

bot.command("usage", async (ctx) => {
  const agent = getState(ctx.from!.id).agent;
  const usage = agent.getUsage();
  const ctxProg = agent.getContextProgress();
  const ctxPct = ctxProg.percent;
  const ctxEmoji = ctxPct >= 95 ? "🔴" : ctxPct >= 80 ? "🟠" : ctxPct >= 50 ? "🟡" : "🟢";
  const lines = [
    `📊 *Usage Stats*`,
    `Last turn: ${usage.last.promptTokens} prompt / ${usage.last.completionTokens} completion tokens`,
    `Session: ${usage.total.promptTokens} prompt / ${usage.total.completionTokens} completion / ${usage.total.turns} turns`,
    `${ctxEmoji} Context: ${ctxProg.usedTokens.toLocaleString()} / ${ctxProg.contextWindow.toLocaleString()} (${ctxPct}%)`,
  ];
  await ctx.reply(lines.join("\n"), { parse_mode: "MarkdownV2" });
});

bot.command("personality", async (ctx) => {
  const agent = getState(ctx.from!.id).agent;
  const ps = agent.getPersonality();
  const parts = (ctx.message?.text ?? "").split(/\s+/);

  if (parts.length === 1 || (parts.length === 2 && parts[1] === "personality")) {
    const names = ps.list();
    const active = ps.getActiveName();
    if (names.length === 0) {
      await ctx.reply("No personalities configured\\. Create one: /personality set default", { parse_mode: "MarkdownV2" });
      return;
    }
    const preview = names.map((n) => n === active ? `● ${escapeMD(n)}` : `○ ${escapeMD(n)}`).join("\n");
    await ctx.reply(`🎭 Personalities:\n\n${preview}`, { parse_mode: "MarkdownV2" });
  } else if (parts[1] === "set" && parts[2]) {
    const ok = ps.setActive(parts[2]);
    await ctx.reply(ok ? `🎭 Personality set to: ${escapeMD(parts[2])}` : `Not found\\. Use /personality to list\\.`, { parse_mode: "MarkdownV2" });
  } else if (parts[1] === "show" && parts[2]) {
    const content = ps.get(parts[2]);
    await ctx.reply(content ? escapeMD(content.slice(0, 3000)) : `Not found\\.`, { parse_mode: "MarkdownV2" });
  } else {
    await ctx.reply("Usage: /personality \\[set <name>] \\[show <name>\\]", { parse_mode: "MarkdownV2" });
  }
});

// ─── Message handler ───

const KNOWN_COMMANDS = new Set(["start", "new", "reset", "history", "model", "memory", "remember", "forget", "search", "tools", "mcp", "cron", "compress", "undo", "retry", "usage", "personality"]);

bot.on("message:text", async (ctx) => {
  const userId = ctx.from!.id;
  const chatId = ctx.chat.id;
  const text = ctx.message.text;
  if (!text) return;

  if (text.startsWith("/")) {
    const cmd = text.slice(1).split("@")[0].split(" ")[0];
    if (!KNOWN_COMMANDS.has(cmd)) return;
  }

  const msgId = ctx.message.message_id;

  withLock(userId, async () => {
    const typingStop = { done: false };
    const typingTimer = keepTyping(chatId, typingStop);

    await setReaction(chatId, msgId, "👀");

    try {
      const result = await streamToChat(chatId, userId, text, REPLY_MODE !== "off" ? msgId : undefined);
      await setReaction(chatId, msgId, "👍");
      log.info("Chat turn completed", { userId, inputLen: text.length, outputLen: result.length });
    } catch (err) {
      log.error("Chat failed", { userId, error: (err as Error).message });
      await setReaction(chatId, msgId, "👎");
      await ctx.reply(`❌ ${(err as Error).message}`).catch(() => {});
    } finally {
      typingStop.done = true;
      clearInterval(typingTimer);
    }
  });
});

// ─── Start ───

const BOT_COMMANDS = [
  { command: "new", description: "New session (memories kept)" },
  { command: "reset", description: "Reset conversation" },
  { command: "compress", description: "Compress conversation context" },
  { command: "undo", description: "Undo last turn" },
  { command: "retry", description: "Retry last input" },
  { command: "usage", description: "Show token usage stats" },
  { command: "personality", description: "Show/set personality" },
  { command: "history", description: "View message history" },
  { command: "model", description: "Show current model info" },
  { command: "memory", description: "View saved memories" },
  { command: "remember", description: "Save a memory" },
  { command: "forget", description: "Delete memories by keyword" },
  { command: "search", description: "Search past conversations" },
  { command: "tools", description: "List registered tools" },
  { command: "mcp", description: "List MCP servers & how to enable" },
  { command: "cron", description: "List scheduled tasks" },
];

bot.start({
  onStart: async (info) => {
    console.log(`Bot @${info.username} running...`);
    await bot.api.setMyCommands(BOT_COMMANDS);
    console.log("   Command menu synced");
    log.info("Bot connected", { username: info.username });

    // Auto-resume: restore recent active sessions from DB
    const recentSessions = sessionDb.recentSessions(20);
    let resumed = 0;
    for (const sess of recentSessions) {
      if (!sess.id.startsWith("tg_")) continue;
      const match = sess.id.match(/^tg_(\d+)_/);
      if (!match) continue;
      const userId = parseInt(match[1], 10);
      if (users.has(userId)) continue;

      const messages = sessionDb.getMessages(sess.id);
      if (messages.length === 0) continue;

      const agentConfig = { ...config, tools: loadedTools };
      const agent = new Agent(agentConfig, memory, userProfile, cronStore, sessionDb, projectContext, honcho);
      agent.setMcpClients(mcpClients);
      agent.loadMessages(messages.map(m => ({ role: m.role, content: m.content })));

      agent.getApprovalSystem().onApprovalRequest(async (toolName, args, reason) => {
        return await requestTelegramApproval(userId, toolName, args, reason);
      });

      users.set(userId, {
        agent,
        sessionId: sess.id,
        lock: Promise.resolve(),
        lastActive: Date.now(),
      });
      resumed++;
    }
    if (resumed > 0) {
      console.log(`   Resumed ${resumed} session(s) from DB`);
      log.info("Sessions resumed", { count: resumed });
    }
  },
});

process.on("SIGINT", () => {
  log.info("Shutting down (SIGINT)");
  cronScheduler.stop();
  memory.close();
  sessionDb.close();
  log.close();
  bot.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  log.info("Shutting down (SIGTERM)");
  cronScheduler.stop();
  memory.close();
  sessionDb.close();
  log.close();
  bot.stop();
  process.exit(0);
});
