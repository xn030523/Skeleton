import chalk from "chalk";

// ANSI helpers
export const CLEAR = "\x1b[2K";
export const CURSOR_UP = "\x1b[1A";
export const CURSOR_HIDE = "\x1b[?25l";
export const CURSOR_SHOW = "\x1b[?25h";
export const RESET = "\x1b[0m";

// Box drawing chars
const TL = "╭";
const TR = "╮";
const BL = "╰";
const BR = "╯";
const H = "─";
const V = "│";

// Skeleton key logo
export function renderHeader(model: string, cwd: string) {
  const shortModel = model.length > 40 ? model.slice(0, 37) + "..." : model;
  const k = chalk.yellow.bold;
  return [
    k("  ██████╗  ") + chalk.bold.white("Skeleton v0.1.0"),
    k("  ██╔══██╗ ") + chalk.gray(shortModel),
    k("  ██████╔╝ ") + chalk.gray(cwd),
    k("  ██╔══╝   "),
    k("  ██║      "),
    k("  ╚═╝      "),
  ].join("\n");
}

export function renderDivider() {
  const width = Math.min(process.stdout.columns || 80, 100);
  return chalk.gray("─".repeat(width));
}

export function renderInputBox() {
  const width = Math.min(process.stdout.columns || 80, 100);
  const innerWidth = width - 4; // ┤ ❯ <content> ├

  const top = chalk.gray(`${TL}${H.repeat(width - 2)}${TR}`);
  const mid = chalk.gray(`${V} `) + chalk.cyan("❯ ") + chalk.gray(" ".repeat(innerWidth - 3)) + chalk.gray(` ${V}`);
  const bot = chalk.gray(`${BL}${H.repeat(width - 2)}${BR}`);

  return `${top}\n${mid}\n${bot}`;
}

export function renderInputPrompt(): string {
  const width = Math.min(process.stdout.columns || 80, 100);
  const innerWidth = width - 4;
  // Top border
  const top = chalk.gray(`${TL}${H.repeat(width - 2)}${TR}`);
  // Input line with cursor placeholder
  const mid = chalk.gray(`${V} `) + chalk.cyan("❯ ");
  const midEnd = chalk.gray(` ${V}`);
  // Bottom border
  const bot = chalk.gray(`${BL}${H.repeat(width - 2)}${BR}`);

  return `\n${top}\n${mid}`;
}

// Thinking spinner
const SPIN_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinIndex = 0;
let spinTimer: ReturnType<typeof setInterval> | null = null;

export function startSpinner(onFrame: (frame: string) => void) {
  spinIndex = 0;
  spinTimer = setInterval(() => {
    onFrame(SPIN_FRAMES[spinIndex % SPIN_FRAMES.length]);
    spinIndex++;
  }, 80);
}

export function stopSpinner() {
  if (spinTimer) {
    clearInterval(spinTimer);
    spinTimer = null;
  }
}
