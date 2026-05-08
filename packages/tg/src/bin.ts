import { Bot } from "grammy";
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
const agents = new Map<number, Agent>();
const bot = new Bot(TOKEN);

console.log(`🔓 Skeleton TG gateway`);
console.log(`   Protocol: ${config.llm.protocol} | Model: ${config.llm.model} | Base: ${config.llm.baseUrl}`);

function getAgent(userId: number): Agent {
  let agent = agents.get(userId);
  if (!agent) {
    agent = new Agent(config, memory);
    agents.set(userId, agent);
    const sessionId = `tg_${userId}_${Date.now()}`;
    db.createSession(sessionId, `Telegram ${userId}`);
  }
  return agent;
}

bot.command("start", async (ctx) => {
  await ctx.reply(
    "🔓 *Skeleton — Reverse Engineering Agent*\n\n" +
      "I learn from every conversation and get smarter over time.\n\n" +
      "/reset — Clear conversation\n" +
      "/history — View history\n" +
      "/model — Show current model\n" +
      "/memory — View saved memories\n" +
      "/remember \\[text\\] — Save a memory\n" +
      "/search \\[query\\] — Search past conversations",
    { parse_mode: "MarkdownV2" },
  );
});

bot.command("reset", async (ctx) => {
  agents.delete(ctx.from!.id);
  await ctx.reply("🔄 Session reset. Memories preserved.");
});

bot.command("history", async (ctx) => {
  const agent = getAgent(ctx.from!.id);
  const history = agent.getHistory();
  if (history.length === 0) {
    await ctx.reply("No messages yet.");
    return;
  }
  const preview = history
    .slice(-10)
    .map((m) => `[${m.role}] ${m.content.slice(0, 100)}`)
    .join("\n");
  await ctx.reply(`📝 Last 10:\n\n${preview}`);
});

bot.command("model", async (ctx) => {
  const { llm } = config;
  await ctx.reply(`🔧 ${llm.protocol} | ${llm.model}\nBase: ${llm.baseUrl}`);
});

bot.command("memory", async (ctx) => {
  const all = memory.list();
  if (all.length === 0) {
    await ctx.reply("No memories yet.");
    return;
  }
  const preview = all
    .slice(0, 20)
    .map((m) => `[${m.category}] ${m.content.slice(0, 80)} (used ${m.useCount}x)`)
    .join("\n");
  await ctx.reply(`🧠 Memories:\n\n${preview}`);
});

bot.command("remember", async (ctx) => {
  const text = ctx.message?.text?.slice("/remember".length).trim();
  if (!text) {
    await ctx.reply("Usage: /remember [something to remember]");
    return;
  }
  memory.add(text, "user", "manual");
  await ctx.reply("💾 Saved.");
});

bot.command("search", async (ctx) => {
  const query = ctx.message?.text?.slice("/search".length).trim();
  if (!query) {
    await ctx.reply("Usage: /search [query]");
    return;
  }
  const results = db.search(query);
  if (results.length === 0) {
    await ctx.reply("No results.");
    return;
  }
  const preview = results
    .slice(0, 10)
    .map((r) => `[${r.role}] ${r.content.slice(0, 80)}`)
    .join("\n");
  await ctx.reply(`🔍 Results:\n\n${preview}`);
});

bot.on("message:text", async (ctx) => {
  const agent = getAgent(ctx.from!.id);
  await ctx.replyWithChatAction("typing");

  try {
    const result = await agent.run(ctx.message.text);
    for (const chunk of splitMessage(result, 4000)) {
      await ctx.reply(chunk);
    }
    db.saveMessage(`tg_${ctx.from!.id}`, { role: "user", content: ctx.message.text });
    db.saveMessage(`tg_${ctx.from!.id}`, { role: "assistant", content: result });
  } catch (err) {
    await ctx.reply(`❌ ${(err as Error).message}`);
  }
});

function splitMessage(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    chunks.push(remaining.slice(0, maxLen));
    remaining = remaining.slice(maxLen);
  }
  return chunks;
}

bot.start();
console.log("Bot running...");
