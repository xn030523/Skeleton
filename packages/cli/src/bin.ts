import { Agent, loadConfig, loadEnv, MemoryStore, SessionDB } from "@skeleton/core";
import chalk from "chalk";
import * as readline from "node:readline";
import {
  renderHeader, renderDivider, renderInputPrompt,
  startSpinner, stopSpinner, CLEAR,
} from "./theme.js";

loadEnv();

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
    console.log(chalk.yellow("No API key. Set SKELETON_API_KEY"));
    process.exit(1);
  }

  const memory = new MemoryStore();
  const db = new SessionDB();

  // One-shot streaming mode
  const oneshot = args.find((a) => !a.startsWith("-"));
  if (oneshot) {
    const agent = new Agent(config, memory);
    await agent.runStream(oneshot, (token) => process.stdout.write(token));
    console.log();
    memory.close();
    db.close();
    return;
  }

  // Interactive mode
  let agent = new Agent(config, memory);
  let sessionId = `sess_${Date.now()}`;
  db.createSession(sessionId);

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
    process.stdout.write("\x1b7");        // DECSC: save cursor position
    process.stdout.write("\n" + bot);     // draw bottom border below
    process.stdout.write("\x1b8");        // DECRC: restore cursor position
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
      memory.close();
      db.close();
      rl.close();
      return;
    }

    if (trimmed === "/new") {
      agent = new Agent(config, memory);
      sessionId = `sess_${Date.now()}`;
      db.createSession(sessionId);
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
      console.log(chalk.gray(`  Session: ${sessionId}`));
      drawBox();
      return;
    }

    if (trimmed === "/memory") {
      const all = memory.list();
      if (all.length === 0) {
        console.log(chalk.gray("  No memories yet. Just chat — I auto-save key findings."));
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
      const results = db.search(trimmed.slice("/search ".length));
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

      db.saveMessage(sessionId, { role: "user", content: trimmed });
      db.saveMessage(sessionId, { role: "assistant", content: result });
    } catch (err) {
      stopSpinner();
      if (spinnerLine) process.stdout.write(`${CLEAR}\r`);
      console.log(chalk.red(`  ✗ ${(err as Error).message}`));
    }

    drawBox();
  });

  rl.on("close", () => {
    memory.close();
    db.close();
  });
}

main().catch(console.error);
