import {
  Agent, loadConfig, loadTools, loadEnv, Logger,
  MemoryStore, SessionDB, UserProfile, ProjectContext,
  CronStore, CronScheduler, ApprovalSystem,
  HonchoUserModel,
} from "@skeleton/core";
import chalk from "chalk";
import * as readline from "node:readline";
import {
  renderHeader, renderDivider, renderInputPrompt,
  startSpinner, stopSpinner, CLEAR,
} from "./theme.js";

loadEnv();
const log = new Logger("cli");

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`skeleton - Reverse engineering AI agent

Usage:
  skeleton            Start interactive REPL
  skeleton "query"    One-shot query (streaming)

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
  /cron               List cron tasks
  /profile            Show user profile

Environment:
  SKELETON_PROTOCOL   openai | anthropic
  SKELETON_API_KEY    Your API key
  SKELETON_BASE_URL   Base URL (before /v1)
  SKELETON_MODEL      Model name
`);
    return;
  }

  const config = loadConfig();
  if (!config.llm.apiKey) {
    log.error("No API key configured");
    console.log(chalk.yellow("No API key. Set SKELETON_API_KEY"));
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
  const { tools, mcpClients, memory: mem, userProfile: profile, cronStore: cron } =
    await loadTools(config as any, memory, userProfile, cronStore);

  // Cron scheduler: execute jobs by spawning a fresh Agent per tick
  const cronScheduler = new CronScheduler(cronStore, async (job) => {
    const agent = new Agent(
      { ...config, tools },
      mem,
      profile,
      cron,
      sessionDb,
      projectContext,
      honcho,
    );
    const result = await agent.run(job.prompt);
    await agent.close();
    return result;
  });

  const agentConfig = { ...config, tools };
  log.info("CLI started", { protocol: config.llm.protocol, model: config.llm.model, toolCount: tools.length });

  // One-shot streaming mode
  const oneshot = args.find((a) => !a.startsWith("-"));
  if (oneshot) {
    const agent = new Agent(agentConfig, memory, userProfile, cronStore, sessionDb, projectContext, honcho);
    agent.setMcpClients(mcpClients);
    log.info("One-shot query", { input: oneshot.slice(0, 80) });
    await agent.runStream(oneshot, (token) => process.stdout.write(token));
    console.log();
    await agent.close();
    cronScheduler.stop();
    sessionDb.close();
    log.close();
    return;
  }

  // Start cron scheduler
  cronScheduler.start();

  // Interactive mode
  let agent = new Agent(agentConfig, memory, userProfile, cronStore, sessionDb, projectContext, honcho);
  agent.setMcpClients(mcpClients);

  // Setup approval callback for CLI
  agent.getApprovalSystem().onApprovalRequest(async (toolName, args, reason) => {
    console.log(chalk.yellow(`\n  ⚠ Approval required: ${toolName} — ${reason}`));
    const answer = await new Promise<string>((resolve) => {
      rl.question(chalk.yellow("  Approve? [y/N/s=session/a=always] "), resolve);
    });
    if (answer.toLowerCase() === "a") {
      agent.getApprovalSystem().approvePermanent(`${toolName}:${JSON.stringify(args)}`);
      return true;
    }
    if (answer.toLowerCase() === "s") {
      agent.getApprovalSystem().approveSession(`${toolName}:${JSON.stringify(args)}`);
      return true;
    }
    return answer.toLowerCase() === "y" || answer.toLowerCase() === "yes";
  });

  // Print header
  console.log(renderHeader(config.llm.model, process.cwd()));
  console.log(renderDivider());
  const width = Math.min(process.stdout.columns || 80, 100);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: "",
  });

  function drawBox() {
    const top = chalk.gray(`╭${"─".repeat(width - 2)}╮`);
    const bot = chalk.gray(`╰${"─".repeat(width - 2)}╯`);
    process.stdout.write(top + "\n");
    rl.setPrompt(chalk.gray("│ ") + chalk.cyan("❯ "));
    rl.prompt();
    process.stdout.write("\x1b7");
    process.stdout.write("\n" + bot);
    process.stdout.write("\x1b8");
  }

  function closeBox(text: string) {
    process.stdout.write("\x1b[1A\x1b[1G\x1b[2K");
    const prefix = chalk.gray("│ ") + chalk.cyan("❯ ");
    const suffix = chalk.gray(" │");
    const displayText = text.length > width - 8 ? text.slice(0, width - 11) + "..." : text;
    const padding = Math.max(0, width - displayText.length - 6);
    process.stdout.write(prefix + displayText + " ".repeat(padding) + suffix + "\n");
    process.stdout.write(chalk.gray(`╰${"─".repeat(width - 2)}╯`) + "\n");
  }

  drawBox();

  rl.on("line", async (input) => {
    const trimmed = input.trim();
    closeBox(trimmed);

    if (!trimmed) { drawBox(); return; }

    // ─── Slash commands ───
    if (trimmed === "/quit" || trimmed === "/exit") {
      console.log(chalk.gray("Bye."));
      log.info("CLI exiting");
      cronScheduler.stop();
      await agent.close();
      sessionDb.close();
      log.close();
      rl.close();
      return;
    }

    if (trimmed === "/new") {
      cronScheduler.stop();
      agent = new Agent(agentConfig, memory, userProfile, cronStore, sessionDb, projectContext, honcho);
      agent.setMcpClients(mcpClients);
      cronScheduler.start();
      console.log(chalk.green("✓ New session."));
      console.log(renderDivider());
      drawBox();
      return;
    }

    if (trimmed === "/reset") {
      agent.reset();
      console.log(chalk.gray("✓ Conversation reset."));
      drawBox();
      return;
    }

    if (trimmed === "/history") {
      const history = agent.getHistory();
      if (history.length === 0) {
        console.log(chalk.gray("  (empty)"));
      } else {
        for (const msg of history) {
          const icon = msg.role === "user" ? chalk.green("❯") : chalk.magenta("◆");
          console.log(`  ${icon} ${msg.content.slice(0, 200)}`);
        }
      }
      drawBox();
      return;
    }

    if (trimmed === "/model") {
      console.log(chalk.gray(`  ${config.llm.protocol} | ${config.llm.model}`));
      console.log(chalk.gray(`  Base: ${config.llm.baseUrl}`));
      drawBox();
      return;
    }

    if (trimmed === "/memory") {
      const all = memory.list();
      if (all.length === 0) {
        console.log(chalk.gray("  No memories yet."));
      } else {
        for (const m of all) {
          console.log(`  ${chalk.yellow(`[${m.category}]`)} ${m.content.slice(0, 120)}`);
        }
      }
      drawBox();
      return;
    }

    if (trimmed.startsWith("/remember ")) {
      memory.add(trimmed.slice("/remember ".length), "user", "manual");
      console.log(chalk.green("✓ Saved to memory."));
      drawBox();
      return;
    }

    if (trimmed.startsWith("/forget ")) {
      const removed = memory.remove(trimmed.slice("/forget ".length));
      console.log(chalk.gray(`✓ Removed ${removed} memory(ies).`));
      drawBox();
      return;
    }

    if (trimmed.startsWith("/search ")) {
      const results = sessionDb.search(trimmed.slice("/search ".length));
      if (results.length === 0) {
        console.log(chalk.gray("  No results."));
      } else {
        for (const r of results) {
          console.log(`  ${chalk.gray(`[${r.role}]`)} ${r.content.slice(0, 150)}`);
        }
      }
      drawBox();
      return;
    }

    if (trimmed === "/tools") {
      const registry = agent.getToolRegistry();
      const toolList = registry.list();
      if (toolList.length === 0) {
        console.log(chalk.gray("  No tools registered."));
      } else {
        for (const t of toolList) {
          console.log(`  ${chalk.cyan(t.name)} — ${t.description.slice(0, 80)}`);
        }
      }
      drawBox();
      return;
    }

    if (trimmed === "/cron") {
      const jobs = cronStore.list();
      if (jobs.length === 0) {
        console.log(chalk.gray("  No scheduled tasks."));
      } else {
        for (const j of jobs) {
          const status = j.enabled ? chalk.green("●") : chalk.gray("○");
          console.log(`  ${status} ${j.name} (${j.runCount} runs) — ${j.nextRun ?? "no upcoming"}`);
        }
      }
      drawBox();
      return;
    }

    if (trimmed === "/profile") {
      const data = userProfile.getLive();
      if (data.preferences.length === 0 && data.projects.length === 0) {
        console.log(chalk.gray("  User profile is empty."));
      } else {
        for (const p of data.preferences) console.log(`  ${chalk.cyan("pref:")} ${p}`);
        for (const p of data.projects) console.log(`  ${chalk.green("proj:")} ${p}`);
        for (const e of data.environment) console.log(`  ${chalk.yellow("env:")}  ${e}`);
      }
      drawBox();
      return;
    }

    if (trimmed.startsWith("/")) {
      console.log(chalk.yellow(`  Unknown: ${trimmed}`));
      drawBox();
      return;
    }

    // ─── Normal chat with streaming ───
    let firstToken = true;
    let spinnerLine = false;

    startSpinner((frame) => {
      if (firstToken) {
        process.stdout.write(`  ${chalk.cyan(frame)} ${chalk.gray("Thinking...")}\r`);
        spinnerLine = true;
      }
    });

    try {
      const result = await agent.runStream(trimmed, (token) => {
        if (firstToken) {
          stopSpinner();
          process.stdout.write(`${CLEAR}\r`);
          firstToken = false;
          spinnerLine = false;
          console.log(chalk.magenta("◆") + chalk.gray(" Skeleton"));
        }
        process.stdout.write(token);
      });

      if (spinnerLine) {
        stopSpinner();
        process.stdout.write(`${CLEAR}\r`);
        console.log(chalk.magenta("◆") + chalk.gray(" Skeleton"));
        process.stdout.write(result);
      }

      console.log();
      console.log(renderDivider());
      log.info("Chat turn completed", { inputLen: trimmed.length, outputLen: result.length });
    } catch (err) {
      stopSpinner();
      if (spinnerLine) process.stdout.write(`${CLEAR}\r`);
      log.error("Chat failed", { error: (err as Error).message });
      console.log(chalk.red(`  ✗ ${(err as Error).message}`));
    }

    drawBox();
  });

  rl.on("close", async () => {
    cronScheduler.stop();
    await agent.close();
    sessionDb.close();
    log.close();
  });
}

main().catch(console.error);
