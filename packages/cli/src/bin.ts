import {
  Agent, loadConfig, loadTools, loadEnv, Logger,
  MemoryStore, SessionDB, UserProfile, ProjectContext,
  CronStore, CronScheduler, ApprovalSystem,
  HonchoUserModel, generateMcpHelpText, listBuiltinMcpServersByCategory, MCP_CATEGORIES,
  renderMarkdown, filterThinkBlocks,
  findProvider, listProviders,
} from "@skeleton/core";
import chalk from "chalk";
import { runSetup } from "./setup.js";
import { runDoctor } from "./doctor.js";
import {
  renderHeader, renderDivider,
  startSpinner, stopSpinner, CLEAR,
} from "./theme.js";

loadEnv();
const log = new Logger("cli");

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    const providerList = listProviders().map(p => p.name).sort().join(", ");
    console.log(`skeleton - Reverse engineering AI agent

Usage:
  skeleton            Start interactive REPL
  skeleton "query"    One-shot query (streaming)
  skeleton setup      Interactive configuration wizard
  skeleton doctor     Run diagnostic checks

Commands:
  /new                New session (memories kept)
  /quit, /exit        Exit
  /reset              Reset conversation
  /history            Show history
  /memory             Show saved memories
  /remember <text>    Save memory
  /forget <keyword>   Delete memories
  /search <query>     Search past conversations
  /model              Show model info
  /tools              List registered tools
  /mcp                List built-in MCP servers & how to enable
  /cron               List cron tasks
  /compress           Compress conversation context
  /undo               Undo last turn
  /retry              Retry last input
  /usage              Show token usage stats
  /personality        Show/set personality (SOUL.md)
  /profile            Show user profile

Configuration:
  ~/.skeleton/config.yaml   Settings (provider, model, mcp, etc.)
  ~/.skeleton/.env          Secrets (API keys)

  Quick start:
    skeleton setup          Pick provider → enter API key → done

  Or set environment variables:
    SKELETON_PROVIDER       Provider name (deepseek, anthropic, gpt, etc.)
    SKELETON_MODEL          Model name (overrides provider default)

  Available providers: ${providerList}

Legacy (still works):
  SKELETON_PROTOCOL        openai | anthropic
  SKELETON_API_KEY         Your API key
  SKELETON_BASE_URL        API base URL
`);
    return;
  }

  if (args[0] === "setup") {
    await runSetup();
    return;
  }

  if (args[0] === "doctor") {
    await runDoctor();
    return;
  }

  const config = loadConfig();
  const providerName = (config.llm as any).provider;
  const provider = providerName ? findProvider(providerName) : null;
  const needsApiKey = !provider?.quirks?.skipApiKey;

  if (!config.llm.apiKey && needsApiKey) {
    log.error("No API key configured");
    const hint = provider
      ? `Set ${provider.apiKeyEnvVars[0]} in ~/.skeleton/.env or as env var`
      : "Set SKELETON_API_KEY or run `skeleton setup`";
    console.log(chalk.yellow(`No API key. ${hint}`));
    process.exit(1);
  }

  // Initialize all stores
  const memory = new MemoryStore();
  const userProfile = new UserProfile();
  const sessionDb = new SessionDB();
  const cronStore = new CronStore();
  const projectContext = new ProjectContext();
  const honcho = new HonchoUserModel();

  // Load tools (includes memory tools, skill tools, cron tools, etc.)
  const { tools, mcpClients, mcpServerToolMap, memory: mem, userProfile: profile, cronStore: cron } =
    await loadTools(config as any, memory, userProfile, cronStore);

  // Cron scheduler: execute jobs by spawning a fresh Agent per tick
  const cronScheduler = new CronScheduler(cronStore, async (job) => {
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
      { ...config, tools },
      mem, profile, cron, sessionDb, projectContext, honcho,
    );
    agent.setMcpClients(mcpClients, mcpServerToolMap);
    const result = await agent.run(job.prompt);
    // Don't close shared MCP connections
    await agent.close({ closeMcp: false });

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

  const agentConfig = { ...config, tools };
  log.info("CLI started", { protocol: config.llm.protocol, model: config.llm.model, toolCount: tools.length });

  // One-shot streaming mode
  const oneshot = args.find((a) => !a.startsWith("-"));
  if (oneshot) {
    const agent = new Agent(agentConfig, memory, userProfile, cronStore, sessionDb, projectContext, honcho);
    agent.setMcpClients(mcpClients, mcpServerToolMap);
    log.info("One-shot query", { input: oneshot.slice(0, 80) });
    await agent.runStream(oneshot, (token) => process.stdout.write(String(token ?? "")));
    console.log();
    await agent.close();
    cronScheduler.stop();
    sessionDb.close();
    log.close();
    return;
  }

  // Start cron scheduler
  cronScheduler.start();

  // Interactive mode — ink-based UI with fixed input area at bottom
  let agent = new Agent(agentConfig, memory, userProfile, cronStore, sessionDb, projectContext, honcho);
  agent.setMcpClients(mcpClients, mcpServerToolMap);

  // Print header above the ink UI
  console.log(renderHeader(config.llm.model, process.cwd()));
  console.log(renderDivider());
  console.log(chalk.gray(`  Tools: ${tools.length} | MCP clients: ${mcpClients.length}`));
  console.log(renderDivider());

  // Check if raw mode (ink) is supported — requires a real TTY
  const useInk = process.stdin.isTTY && process.stdout.isTTY;

  if (useInk) {
    // Ink-based interactive chat with fixed input area at bottom
    const { launchChatUI } = await import("./chat-ui.js");
    await launchChatUI(agent, config.llm.model, tools.length, mcpClients.length, {
      memory: mem,
      userProfile: profile,
      sessionDb,
      cronStore: cron,
      config,
      onQuit: async () => {
        cronScheduler.stop();
        await agent.close();
        sessionDb.close();
        log.close();
      },
    });
  } else {
    // Fallback: simple readline mode for non-TTY (piped stdin, etc.)
    const { launchReadlineChat } = await import("./readline-chat.js");
    await launchReadlineChat(agent, config, mem, profile, sessionDb, cron, cronScheduler, tools.length, mcpClients.length);
  }

  cronScheduler.stop();
  await agent.close();
  sessionDb.close();
  log.close();
}

main().catch(console.error);
