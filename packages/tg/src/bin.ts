import { Bot } from "grammy";
import { Agent, loadConfig, loadEnv, Logger, MemoryStore, SessionDB } from "@skeleton/core";

loadEnv();
const log = new Logger("tg");

const TOKEN = process.env.SKELETON_TG_TOKEN ?? "";
if (!TOKEN) {
  console.error("Set SKELETON_TG_TOKEN environment variable");
  process.exit(1);
}

const config = loadConfig();
if (!config.llm.apiKey) {
  console.error("Set SKELETON_API_KEY or create skeleton.yaml");
  process.exit(1);
}

// ─── Access control config ───

type GroupMode = "off" | "mention" | "all";

const ALLOWED_USERS = parseAllowedUsers(process.env.SKELETON_TG_ALLOWED_USERS ?? "*");
const GROUP_MODE: GroupMode = (process.env.SKELETON_TG_GROUP_MODE as GroupMode) ?? "mention";
const REACTIONS = (process.env.SKELETON_TG_REACTIONS ?? "true").toLowerCase() !== "false";

function parseAllowedUsers(raw: string): Set<number> | null {
  if (raw === "*" || raw === "") return null; // null = allow all
  const ids = raw.split(",").map((s) => Number(s.trim())).filter((n) => !isNaN(n) && n > 0);
  return ids.length > 0 ? new Set(ids) : null;
}

function isUserAllowed(userId: number): boolean {
  if (ALLOWED_USERS === null) return true; // wildcard
  return ALLOWED_USERS.has(userId);
}

const db = new SessionDB();
const memory = new MemoryStore();

// Per-user state
interface UserState {
  agent: Agent;
  sessionId: string;
  lock: Promise<void>;
}
const users = new Map<number, UserState>();

const bot = new Bot(TOKEN);

console.log(`🔓 Skeleton TG gateway`);
console.log(`   Protocol: ${config.llm.protocol} | Model: ${config.llm.model} | Base: ${config.llm.baseUrl}`);
console.log(`   Allowed users: ${ALLOWED_USERS === null ? "*" : [...ALLOWED_USERS].join(", ")}`);
console.log(`   Group mode: ${GROUP_MODE} (off / mention / all)`);
log.info("TG gateway started", { protocol: config.llm.protocol, model: config.llm.model, groupMode: GROUP_MODE });

// ─── Access control middleware ───

bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return; // no user info

  // DM: check user whitelist
  if (ctx.chat?.type === "private") {
    if (!isUserAllowed(userId)) {
      console.log(`   ⛔ DM rejected: user ${userId}`);
      log.warn("DM rejected", { userId });
      return; // silently drop
    }
    return next();
  }

  // Group chat: check group mode
  if (ctx.chat?.type === "group" || ctx.chat?.type === "supergroup") {
    if (GROUP_MODE === "off") return; // ignore all group messages

    // Always allow commands (slash commands)
    if (ctx.message?.text?.startsWith("/")) {
      if (!isUserAllowed(userId)) return;
      return next();
    }

    if (GROUP_MODE === "all") {
      if (!isUserAllowed(userId)) return;
      return next();
    }

    // GROUP_MODE === "mention" — only respond when @bot is mentioned
    const botInfo = bot.botInfo;
    const text = ctx.message?.text ?? "";
    const mentionStr = `@${botInfo.username}`;
    const isMentioned = text.includes(mentionStr);

    if (isMentioned) {
      if (!isUserAllowed(userId)) return;
      // Strip @mention from text before sending to agent
      if (ctx.message) {
        ctx.message.text = text.replace(mentionStr, "").trim();
      }
      return next();
    }

    return; // not mentioned, ignore
  }

  return next();
});

function getState(userId: number): UserState {
  let state = users.get(userId);
  if (!state) {
    state = {
      agent: new Agent(config, memory),
      sessionId: `tg_${userId}_${Date.now()}`,
      lock: Promise.resolve(),
    };
    db.createSession(state.sessionId, `Telegram ${userId}`);
    users.set(userId, state);
  }
  return state;
}

// ─── MarkdownV2 helpers ───

const MD_ESCAPE_RE = /([_*\[\]()~`>#\+=|{}.!\\-])/g;

function escapeMD(text: string): string {
  return text.replace(MD_ESCAPE_RE, "\\$1");
}

function truncateMD(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit - 3) + "…";
}

// ─── Streaming via editMessage (Hermes-style) ───

const STREAM_CURSOR = " ▉";
const EDIT_INTERVAL_MS = 2500;
const BUFFER_THRESHOLD = 40;
const MAX_MSG_LEN = 4000;
const MAX_FLOOD_STRIKES = 3;

async function streamToChat(
  chatId: number,
  userId: number,
  text: string,
): Promise<string> {
  const state = getState(userId);
  let accumulated = "";
  let streamDone = false;
  let streamResult = "";

  // Token callback — pure synchronous buffer, NO API calls
  const onToken = (token: string) => { accumulated += token; };

  // Start stream in background
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
  let fallbackPrefix = ""; // last visible text before edit broke

  // Phase 1: wait for first meaningful content, then send initial message
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

  // Stream finished before we could even send a message
  if (!msgId) {
    return await streamPromise;
  }

  // Phase 2: progressive edit loop — polls buffer at controlled interval
  while (!streamDone) {
    await new Promise(r => setTimeout(r, currentInterval));

    if (!editSupported) continue; // in fallback mode — skip edits, wait for stream to finish

    const newChars = accumulated.length - lastEditLen;
    if (newChars < BUFFER_THRESHOLD) continue;

    const displayText = truncateMD(accumulated, MAX_MSG_LEN) + STREAM_CURSOR;
    if (displayText === lastSentText) continue;

    lastEditLen = accumulated.length;

    try {
      await bot.api.editMessageText(chatId, msgId!, displayText);
      lastSentText = displayText;
      floodStrikes = 0;
      currentInterval = EDIT_INTERVAL_MS; // reset interval on success
    } catch (err: unknown) {
      const desc = ((err as Error)?.message ?? "").toLowerCase();
      if (desc.includes("not modified")) continue;
      if (desc.includes("flood") || desc.includes("retry after") || desc.includes("too many")) {
        floodStrikes++;
        currentInterval = Math.min(currentInterval * 2, 10000);
        if (floodStrikes >= MAX_FLOOD_STRIKES) {
          // Enter fallback mode — stop editing, send fresh message at the end
          editSupported = false;
          fallbackPrefix = lastSentText.replace(STREAM_CURSOR, "");
          log.warn("Flood control: entering fallback mode", { userId, floodStrikes });
        }
        continue;
      }
      // Other edit errors — enter fallback mode
      editSupported = false;
      fallbackPrefix = lastSentText.replace(STREAM_CURSOR, "");
      log.warn("Edit failed: entering fallback mode", { userId, error: desc });
    }
  }

  const result = await streamPromise;

  // Phase 3: final delivery
  if (editSupported && msgId) {
    // Normal path: final edit — remove cursor, try MarkdownV2
    const finalText = truncateMD(result, MAX_MSG_LEN);
    try {
      await bot.api.editMessageText(chatId, msgId, formatResponse(finalText), { parse_mode: "MarkdownV2" });
    } catch {
      try { await bot.api.editMessageText(chatId, msgId, finalText); } catch { /* ignore */ }
    }
  } else if (fallbackPrefix) {
    // Fallback path: send only the continuation as a fresh message
    const continuation = result.slice(fallbackPrefix.length);
    if (continuation.trim()) {
      try {
        const finalText = truncateMD(continuation, MAX_MSG_LEN);
        await bot.api.sendMessage(chatId, finalText);
      } catch { /* ignore */ }
    }
    // Try to strip cursor from the stuck preview message
    try {
      await bot.api.editMessageText(chatId, msgId!, fallbackPrefix);
    } catch { /* ignore */ }
  } else if (msgId) {
    // No edits happened at all — just send the complete result
    const finalText = truncateMD(result, MAX_MSG_LEN);
    try {
      await bot.api.sendMessage(chatId, finalText);
    } catch { /* ignore */ }
  }

  return result;
}


function formatResponse(text: string): string {
  return escapeMD(text);
}

// ─── Concurrency: serialize per-user requests ───

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
      "/search \\[query\\] — Search past conversations",
    { parse_mode: "MarkdownV2" },
  );
});

bot.command("new", async (ctx) => {
  const userId = ctx.from!.id;
  const state = getState(userId);
  state.agent = new Agent(config, memory);
  state.sessionId = `tg_${userId}_${Date.now()}`;
  db.createSession(state.sessionId, `Telegram ${userId}`);
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
  const results = db.search(query);
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

// ─── Message handler with streaming + concurrency ───

const KNOWN_COMMANDS = new Set(["start", "new", "reset", "history", "model", "memory", "remember", "forget", "search"]);

bot.on("message:text", async (ctx) => {
  const userId = ctx.from!.id;
  const chatId = ctx.chat.id;
  const text = ctx.message.text;
  if (!text) return;

  // Drop unrecognized slash commands — only registered commands are valid
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
      const state = getState(userId);
      const result = await streamToChat(chatId, userId, text);

      db.createSession(state.sessionId, `Telegram ${userId}`);
      db.saveMessage(state.sessionId, { role: "user", content: text });
      db.saveMessage(state.sessionId, { role: "assistant", content: result });
      await setReaction(chatId, msgId, "👍");
      log.info("Chat turn completed", { userId, sessionId: state.sessionId, inputLen: text.length, outputLen: result.length });
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

// Sync bot command menu (overwrites any stale BotFather commands)
const BOT_COMMANDS = [
  { command: "new", description: "New session (memories kept)" },
  { command: "reset", description: "Reset conversation" },
  { command: "history", description: "View message history" },
  { command: "model", description: "Show current model info" },
  { command: "memory", description: "View saved memories" },
  { command: "remember", description: "Save a memory" },
  { command: "forget", description: "Delete memories by keyword" },
  { command: "search", description: "Search past conversations" },
];

bot.start({
  onStart: async (info) => {
    console.log(`Bot @${info.username} running...`);
    await bot.api.setMyCommands(BOT_COMMANDS);
    console.log("   Command menu synced");
    log.info("Bot connected", { username: info.username });
  },
});

process.on("SIGINT", () => {
  log.info("Shutting down (SIGINT)");
  memory.close();
  db.close();
  log.close();
  bot.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  log.info("Shutting down (SIGTERM)");
  memory.close();
  db.close();
  log.close();
  bot.stop();
  process.exit(0);
});
