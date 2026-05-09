/**
 * Skeleton CLI — readline fallback for non-TTY environments.
 *
 * Uses the shared CommandProcessor for all slash commands,
 * so it has feature parity with the ink TUI.
 */

import * as readline from "node:readline";
import chalk from "chalk";
import type { Agent, MemoryStore, UserProfile, SessionDB, CronStore, CronScheduler, CommandContext } from "@skeleton/core";
import { processCommandAsync, filterThinkBlocks, formatToolCompletion } from "@skeleton/core";
import { renderDivider, renderContextProgress, startSpinner, stopSpinner, CLEAR } from "./theme.js";
import { ReadlineAdapter } from "./output-adapter.js";

export function launchReadlineChat(
  agent: Agent,
  config: { llm: { protocol: string; model: string; baseUrl: string }; maxTurns?: number; systemPrompt?: string; tools?: unknown[] },
  memory: MemoryStore,
  userProfile: UserProfile,
  sessionDb: SessionDB,
  cronStore: CronStore,
  cronScheduler: CronScheduler,
  toolCount: number,
  mcpCount: number,
): Promise<void> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan("❯ ") ,
    });

    // Tool progress display — use Hermes-style pretty format
    agent.onToolCall = () => {};
    agent.onToolComplete = (info) => {
      const line = formatToolCompletion(info.name, info.args, info.duration, {
        isError: info.isError,
        useColor: true,
      });
      process.stdout.write(`\r\x1b[2K  ${line}\n`);
    };
    agent.onToolResult = () => {};

    // Build shared command context and adapter
    const cmdCtx: CommandContext = {
      agent,
      memory,
      sessionDb,
      cronStore,
      config,
      userProfile,
    };
    const adapter = new ReadlineAdapter(rl, agent, cronScheduler, sessionDb);

    rl.prompt();

    rl.on("line", async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { rl.prompt(); return; }

      // Slash commands — delegate to shared processor
      if (trimmed.startsWith("/")) {
        try {
          await processCommandAsync(trimmed, cmdCtx, adapter);
        } catch (err) {
          console.log(chalk.red(`  ✗ ${(err as Error).message}`));
        }
        console.log(renderDivider());
        rl.prompt();
        return;
      }

      // Normal chat with streaming
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
          const safeToken = String(token ?? "");
          const filtered = filterThinkBlocks(safeToken);
          if (!filtered) return;
          if (firstToken) {
            stopSpinner();
            process.stdout.write(`${CLEAR}\r`);
            firstToken = false;
            spinnerLine = false;
            process.stdout.write(chalk.magenta("◆") + chalk.gray(" Skeleton") + "\n");
          }
          process.stdout.write(filtered);
        });

        if (spinnerLine) {
          stopSpinner();
          process.stdout.write(`${CLEAR}\r`);
          process.stdout.write(chalk.magenta("◆") + chalk.gray(" Skeleton") + "\n");
          process.stdout.write(result ?? "");
        }
        console.log("\n" + renderDivider());
        const ctx = agent.getContextProgress();
        console.log("  " + renderContextProgress(ctx.usedTokens, ctx.contextWindow, ctx.percent));
        console.log(renderDivider());
      } catch (err) {
        stopSpinner();
        if (spinnerLine) process.stdout.write(`${CLEAR}\r`);
        console.log(chalk.red(`  ✗ ${(err as Error).message}`));
      }

      rl.prompt();
    });

    rl.on("close", async () => {
      cronScheduler.stop();
      await agent.close();
      sessionDb.close();
      resolve();
    });
  });
}
