/**
 * Skeleton CLI — readline fallback for non-TTY environments.
 *
 * Simple prompt without box drawing. Works in piped/redirected stdin.
 */

import * as readline from "node:readline";
import chalk from "chalk";
import type { Agent, MemoryStore, UserProfile, SessionDB, CronStore, CronScheduler } from "@skeleton/core";
import { filterThinkBlocks, formatToolCompletion } from "@skeleton/core";
import { renderDivider, renderContextProgress, startSpinner, stopSpinner, CLEAR } from "./theme.js";

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
    agent.onToolCall = () => {
      // No-op: we wait for onToolComplete to show the line with duration
    };
    agent.onToolComplete = (info) => {
      const line = formatToolCompletion(info.name, info.args, info.duration, {
        isError: info.isError,
        useColor: true,
      });
      process.stdout.write(`\r\x1b[2K  ${line}\n`);
    };
    agent.onToolResult = () => {}; // legacy no-op

    rl.prompt();

    rl.on("line", async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { rl.prompt(); return; }

      // Slash commands
      if (trimmed === "/quit" || trimmed === "/exit") {
        console.log(chalk.gray("Bye."));
        cronScheduler.stop();
        await agent.close();
        sessionDb.close();
        rl.close();
        resolve();
        return;
      }

      if (trimmed === "/new") {
        agent.reset();
        console.log(chalk.green("✓ New session."));
        console.log(renderDivider());
        rl.prompt();
        return;
      }

      if (trimmed === "/reset") {
        agent.reset();
        console.log(chalk.gray("✓ Conversation reset."));
        rl.prompt();
        return;
      }

      if (trimmed === "/model") {
        console.log(chalk.gray(`  ${config.llm.protocol} | ${config.llm.model}`));
        rl.prompt();
        return;
      }

      if (trimmed === "/memory") {
        const all = memory.list();
        if (all.length === 0) {
          console.log(chalk.gray("  No memories yet."));
        } else {
          for (const m of all) console.log(`  ${chalk.yellow(`[${m.category}]`)} ${m.content.slice(0, 120)}`);
        }
        rl.prompt();
        return;
      }

      if (trimmed.startsWith("/remember ")) {
        memory.add(trimmed.slice(10), "user", "manual");
        console.log(chalk.green("✓ Saved to memory."));
        rl.prompt();
        return;
      }

      if (trimmed.startsWith("/forget ")) {
        const removed = memory.remove(trimmed.slice(8));
        console.log(chalk.gray(`✓ Removed ${removed} memory(ies).`));
        rl.prompt();
        return;
      }

      if (trimmed === "/tools") {
        const registry = agent.getToolRegistry();
        const toolList = registry.list();
        for (const t of toolList) console.log(`  ${chalk.cyan(t.name)} — ${t.description.slice(0, 80)}`);
        rl.prompt();
        return;
      }

      if (trimmed === "/usage") {
        const usage = agent.getUsage();
        const ctx = agent.getContextProgress();
        console.log(`  Last: ${usage.last.promptTokens}+${usage.last.completionTokens} tokens`);
        console.log(`  Total: ${usage.total.promptTokens}+${usage.total.completionTokens} | Turns: ${usage.total.turns}`);
        console.log("  Context: " + renderContextProgress(ctx.usedTokens, ctx.contextWindow, ctx.percent));
        rl.prompt();
        return;
      }

      if (trimmed === "/undo") {
        const ok = agent.undoLastTurn();
        console.log(ok ? chalk.green("  ✓ Last turn undone.") : chalk.gray("  Nothing to undo."));
        rl.prompt();
        return;
      }

      if (trimmed.startsWith("/")) {
        console.log(chalk.yellow(`  Unknown: ${trimmed}`));
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
        // Show context progress after each turn (Hermes-style)
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
