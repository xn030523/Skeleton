import { Marked } from "marked";
import { markedTerminal } from "marked-terminal";
import chalk from "chalk";
import highlight from "cli-highlight";

const marked = new Marked(
  markedTerminal({
    code: (code: string, lang?: string) => {
      try {
        return highlight(code, {
          language: lang || "plaintext",
          theme: "github-dark",
          ignoreIllegals: true,
        });
      } catch {
        return chalk.gray(code);
      }
    },
    heading: (text: string, level: number) => {
      const styles = [chalk.bold.cyan, chalk.bold.green, chalk.bold.yellow, chalk.bold, chalk.bold, chalk.bold];
      return `\n${(styles[level - 1] ?? chalk.bold)(text)}\n`;
    },
    listitem: (text: string) => chalk.cyan("  • ") + text,
    strong: (text: string) => chalk.bold.white(text),
    em: (text: string) => chalk.italic(text),
    codespan: (code: string) => chalk.bgBlackBright.white(` ${code} `),
    blockquote: (text: string) => chalk.gray("│ ") + text,
  }),
);

export function renderMarkdown(text: string): string {
  return marked.parse(text) as string;
}
