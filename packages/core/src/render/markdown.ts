import chalk from "chalk";

/**
 * Terminal Markdown renderer.
 *
 * Converts Markdown text to ANSI-formatted terminal output.
 * Supports: headings, bold, italic, code blocks with syntax highlighting,
 * inline code, blockquotes, lists, links, diff coloring, tables.
 *
 * No external dependencies — chalk handles all ANSI styling.
 * Syntax highlighting is done via simple heuristic tokenization
 * to avoid the heavy cli-highlight dependency in core.
 */

// ─── Inline patterns ───

const INLINE_RE = /(\*\*.*?\*\*|\*.*?\*|`[^`]+`|\[.*?\]\(.*?\)|~~.*?~~)/g;

// ─── Block-level renderer ───

export function renderMarkdown(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;
  let codeLang = "";
  let codeLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // ─── Fenced code block ───
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        // Close code block
        result.push(renderCodeBlock(codeLines, codeLang));
        codeLines = [];
        codeLang = "";
        inCodeBlock = false;
      } else {
        // Open code block
        inCodeBlock = true;
        codeLang = line.slice(3).trim().toLowerCase();
      }
      continue;
    }

    if (inCodeBlock) {
      codeLines.push(line);
      continue;
    }

    // ─── Heading ───
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const styles = [
        chalk.bold.cyan,
        chalk.bold.green,
        chalk.bold.yellow,
        chalk.bold.white,
        chalk.bold.white,
        chalk.bold.white,
      ];
      result.push(`\n${(styles[level - 1] ?? chalk.bold)(renderInline(headingMatch[2]))}\n`);
      continue;
    }

    // ─── Horizontal rule ───
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      result.push(chalk.gray("─".repeat(36)));
      continue;
    }

    // ─── Blockquote ───
    if (line.startsWith(">")) {
      const content = line.slice(1).trim();
      result.push(chalk.gray("│ ") + renderInline(content));
      continue;
    }

    // ─── Unordered list ───
    const ulMatch = line.match(/^(\s*)([-*+])\s+(.+)/);
    if (ulMatch) {
      const indent = "  ".repeat(Math.floor(ulMatch[1].length / 2));
      result.push(`${indent}${chalk.cyan("•")} ${renderInline(ulMatch[3])}`);
      continue;
    }

    // ─── Ordered list ───
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.+)/);
    if (olMatch) {
      const indent = "  ".repeat(Math.floor(olMatch[1].length / 2));
      result.push(`${indent}${chalk.cyan(`${olMatch[2]}.`)} ${renderInline(olMatch[3])}`);
      continue;
    }

    // ─── Table row ───
    if (line.startsWith("|") && line.endsWith("|")) {
      // Skip separator rows (|---|---|)
      if (/^\|[\s\-:]+\|/.test(line)) {
        result.push(chalk.gray("─".repeat(40)));
        continue;
      }
      const cells = line.split("|").filter((c) => c.trim() !== "");
      const rendered = cells.map((c) => renderInline(c.trim())).join("  ");
      result.push(`  ${rendered}`);
      continue;
    }

    // ─── Empty line ───
    if (line.trim() === "") {
      result.push("");
      continue;
    }

    // ─── Plain text ───
    result.push(renderInline(line));
  }

  // Unclosed code block
  if (inCodeBlock && codeLines.length > 0) {
    result.push(renderCodeBlock(codeLines, codeLang));
  }

  return result.join("\n");
}

// ─── Inline renderer ───

function renderInline(text: string): string {
  return text.replace(INLINE_RE, (match) => {
    // Bold: **text**
    if (match.startsWith("**") && match.endsWith("**")) {
      return chalk.bold(match.slice(2, -2));
    }
    // Italic: *text*
    if (match.startsWith("*") && match.endsWith("*") && !match.startsWith("**")) {
      return chalk.italic(match.slice(1, -1));
    }
    // Inline code: `text`
    if (match.startsWith("`") && match.endsWith("`")) {
      return chalk.bgBlackBright.white(` ${match.slice(1, -1)} `);
    }
    // Link: [text](url)
    const linkMatch = match.match(/^\[(.+?)\]\((.+?)\)$/);
    if (linkMatch) {
      return `${chalk.cyan.underline(linkMatch[1])} ${chalk.gray(`(${linkMatch[2]})`)}`;
    }
    // Strikethrough: ~~text~~
    if (match.startsWith("~~") && match.endsWith("~~")) {
      return chalk.strikethrough(match.slice(2, -2));
    }
    return match;
  });
}

// ─── Code block renderer ───

function renderCodeBlock(lines: string[], lang: string): string {
  const result: string[] = [];

  // Language label
  if (lang) {
    result.push(chalk.gray(`── ${lang}`));
  }

  for (const line of lines) {
    // Diff-aware coloring
    if (lang === "diff") {
      if (line.startsWith("+")) {
        result.push(chalk.green(line));
      } else if (line.startsWith("-")) {
        result.push(chalk.red(line));
      } else if (line.startsWith("@@")) {
        result.push(chalk.gray(line));
      } else {
        result.push(chalk.gray("  " + line));
      }
    } else {
      // Simple heuristic highlighting for common patterns
      result.push(colorizeLine(line, lang));
    }
  }

  return result.join("\n");
}

// ─── Simple syntax colorizer ───

function colorizeLine(line: string, lang: string): string {
  // Comments
  if (/^\s*(\/\/|#|;|--)\s/.test(line) || /^\s*(\/\/|#|;|--)/.test(line)) {
    return chalk.gray(line);
  }
  // Strings
  if (/^["']/.test(line) || /["'].*["']/.test(line)) {
    // Partial: just color quoted strings
    return line.replace(/(["'])(.*?)\1/g, (_, q, content) => chalk.green(`${q}${content}${q}`));
  }
  // Numbers
  let result = line.replace(/\b(\d+\.?\d*)\b/g, (_, num) => chalk.yellow(num));
  // Keywords (common across languages)
  const keywords = /\b(function|const|let|var|if|else|return|for|while|class|import|export|from|async|await|def|self|print|None|True|False|null|undefined|true|false|struct|fn|pub|impl|use|mod|int|void|char|float|double|unsigned|signed|long|short|byte)\b/g;
  result = result.replace(keywords, (kw) => chalk.magenta(kw));
  return result;
}
