import { Bot, InlineKeyboard } from "grammy";
import { Agent, loadConfig, loadEnv, MemoryStore, SessionDB } from "@skeleton/core";

loadEnv();

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
  // Telegram counts UTF-16 code units; rough approximation
  if (text.length <= limit) return text;
  return text.slice(0, limit - 3) + "…";
}

// ─── Streaming via editMessage ───

const EDIT_INTERVAL_MS = 800;
const MAX_MSG_LEN = 4000;

async function streamToChat(
  chatId: number,
  userId: number,
  text: string,
): Promise<string> {
  const state = getState(userId);
  let msgId: number | undefined;
  let accumulated = "";
  let lastEdit = 0;
  let firstChunk = true;

  const result = await state.agent.runStream(text, async (token) => {
    accumulated += token;

    if (!msgId) {
      // First token — send initial message
      try {
        const msg = await bot.api.sendMessage(
          chatId,
          formatResponse(accumulated),
          { parse_mode: "MarkdownV2" },
        );
        msgId = msg.message_id;
        firstChunk = false;
        lastEdit = Date.now();
      } catch {
        // MarkdownV2 parse failed — send as plain text
        const msg = await bot.api.sendMessage(chatId, accumulated);
        msgId = msg.message_id;
        firstChunk = false;
        lastEdit = Date.now();
      }
      return;
    }

    const now = Date.now();
    if (now - lastEdit >= EDIT_INTERVAL_MS) {
      lastEdit = now;
      try {
        await bot.api.editMessageText(
          chatId,
          msgId,
          formatResponse(truncateMD(accumulated, MAX_MSG_LEN)),
          { parse_mode: "MarkdownV2" },
        );
      } catch (err: unknown) {
        const desc = (err as Error)?.message ?? "";
        if (desc.includes("message is not modified")) return;
        if (desc.includes("can't parse")) {
          // Fallback to plain text on parse error
          try {
            await bot.api.editMessageText(
              chatId,
              msgId,
              truncateMD(accumulated, MAX_MSG_LEN),
            );
          } catch { /* ignore */ }
        }
      }
    }
  });

  // Final edit with complete response
  if (msgId) {
    try {
      await bot.api.editMessageText(
        chatId,
        msgId,
        formatResponse(truncateMD(result, MAX_MSG_LEN)),
        { parse_mode: "MarkdownV2" },
      );
    } catch {
      try {
        await bot.api.editMessageText(
          chatId,
          msgId,
          truncateMD(result, MAX_MSG_LEN),
        );
      } catch { /* ignore */ }
    }
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

bot.on("message:text", async (ctx) => {
  const userId = ctx.from!.id;
  const chatId = ctx.chat.id;
  const text = ctx.message.text;

  withLock(userId, async () => {
    const typingStop = { done: false };
    const typingTimer = keepTyping(chatId, typingStop);

    try {
      const state = getState(userId);
      const result = await streamToChat(chatId, userId, text);

      db.saveMessage(state.sessionId, { role: "user", content: text });
      db.saveMessage(state.sessionId, { role: "assistant", content: result });
    } catch (err) {
      await ctx.reply(`❌ ${(err as Error).message}`).catch(() => {});
    } finally {
      typingStop.done = true;
      clearInterval(typingTimer);
    }
  });
});

// ─── Start ───

bot.start({
  onStart: (info) => {
    console.log(`Bot @${info.username} running...`);
  },
});

process.on("SIGINT", () => {
  memory.close();
  db.close();
  bot.stop();
  process.exit(0);
});

process.on("SIGTERM", () => {
  memory.close();
  db.close();
  bot.stop();
  process.exit(0);
});
