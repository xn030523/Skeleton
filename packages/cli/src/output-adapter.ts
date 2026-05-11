/**
 * Output Adapter — abstracts display differences between ink and readline.
 *
 * InkAdapter: React state updates
 * ReadlineAdapter: console.log + ANSI escapes
 */

import chalk from "chalk";
import type * as readline from "node:readline";
import type { Agent, SessionDB } from "@skeleton/core";
import { filterThinkBlocks } from "@skeleton/core";
import type { OutputAdapter } from "@skeleton/core";
import type { CronScheduler } from "@skeleton/core";

// ── Ink Adapter ────────────────────────────────────────────────────

export class InkAdapter implements OutputAdapter {
  constructor(
    private addLineFn: (line: string) => void,
    private addLinesFn: (lines: string[]) => void,
    private clearOutputFn: () => void,
    private setInputFn: (text: string) => void,
    private onQuitFn: () => Promise<void>,
    private agent: Agent,
    private streamCallback: (token: string) => void,
  ) {}

  addLine(line: string): void { this.addLineFn(line); }
  addLines(lines: string[]): void { this.addLinesFn(lines); }
  clearScreen(): void { this.clearOutputFn(); }
  setInput(text: string): void { this.setInputFn(text); }
  async quit(): Promise<void> { await this.onQuitFn(); }

  async runSkill(fullInput: string): Promise<void> {
    await this.agent.runStream(fullInput, this.streamCallback);
  }
}

// ── Readline Adapter ───────────────────────────────────────────────

export class ReadlineAdapter implements OutputAdapter {
  constructor(
    private rl: readline.Interface,
    private agent: Agent,
    private cronScheduler: CronScheduler,
    private sessionDb: SessionDB,
  ) {}

  addLine(line: string): void { console.log(line); }
  addLines(lines: string[]): void { lines.forEach(l => console.log(l)); }

  clearScreen(): void {
    process.stdout.write("\x1b[2J\x1b[H");
  }

  setInput(_text: string): void {
    // readline does not support pre-filling input
  }

  async quit(): Promise<void> {
    this.cronScheduler.stop();
    await this.agent.close();
    this.sessionDb.close();
    this.rl.close();
  }

  async runSkill(fullInput: string): Promise<void> {
    try {
      const result = await this.agent.run(fullInput);
      const clean = filterThinkBlocks(result);
      console.log(chalk.magenta("◆") + " " + clean);
    } catch (err) {
      console.log(chalk.red(`  ✗ ${(err as Error).message}`));
    }
  }
}
