/**
 * Post-write delta lint — automatically lint files after write_file/patch/edit.
 *
 * Runs in-process syntax checks for Python, JSON, YAML, TOML.
 * Surfaces errors immediately so the agent can self-correct
 * instead of shipping broken files downstream.
 *
 * Registers as a post_tool_call hook. Returns lint diagnostics
 * as context injection so the agent sees them on the next turn.
 */

import fs from "node:fs";
import path from "node:path";
import type { HookContext, HookResult } from "../hooks.js";

const WRITE_TOOLS = new Set(["write_file", "patch", "edit", "fuzzy_edit"]);

interface LintDiagnostic {
  file: string;
  line?: number;
  message: string;
  severity: "error" | "warning";
}

export function postWriteLintHook(ctx: HookContext): HookResult {
  const toolName = ctx.toolName ?? "";
  if (!WRITE_TOOLS.has(toolName)) return {};

  const filePath = String(
    (ctx.args as Record<string, unknown>)?.path ??
    (ctx.args as Record<string, unknown>)?.file_path ??
    "",
  );
  if (!filePath) return {};

  const diagnostics = lintFile(filePath);
  if (diagnostics.length === 0) return {};

  const report = diagnostics
    .map(d => `  ${d.severity.toUpperCase()}: ${d.file}${d.line ? `:${d.line}` : ""} — ${d.message}`)
    .join("\n");

  return {
    contextInjection: `\n[POST-WRITE LINT]\n${report}\nFix these issues before proceeding.\n`,
  };
}

function lintFile(filePath: string): LintDiagnostic[] {
  if (!fs.existsSync(filePath)) return [];

  const ext = path.extname(filePath).toLowerCase();
  const content = fs.readFileSync(filePath, "utf-8");

  switch (ext) {
    case ".json":
      return lintJson(filePath, content);
    case ".yaml":
    case ".yml":
      return lintYaml(filePath, content);
    case ".toml":
      return lintToml(filePath, content);
    case ".py":
      return lintPython(filePath, content);
    default:
      return [];
  }
}

function lintJson(filePath: string, content: string): LintDiagnostic[] {
  try {
    JSON.parse(content);
    return [];
  } catch (err) {
    const msg = (err as Error).message;
    const lineMatch = msg.match(/position (\d+)/);
    let line: number | undefined;
    if (lineMatch) {
      const pos = parseInt(lineMatch[1], 10);
      line = content.slice(0, pos).split("\n").length;
    }
    return [{ file: filePath, line, message: msg, severity: "error" }];
  }
}

function lintYaml(filePath: string, content: string): LintDiagnostic[] {
  try {
    const { parse } = require("yaml") as typeof import("yaml");
    parse(content);
    return [];
  } catch (err) {
    const msg = (err as Error).message;
    const lineMatch = msg.match(/at line (\d+)/);
    const line = lineMatch ? parseInt(lineMatch[1], 10) : undefined;
    return [{ file: filePath, line, message: msg.split("\n")[0], severity: "error" }];
  }
}

function lintToml(filePath: string, content: string): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith("#")) continue;

    if (line.startsWith("[")) {
      if (!line.endsWith("]")) {
        diagnostics.push({ file: filePath, line: i + 1, message: "Unclosed table header", severity: "error" });
      }
      continue;
    }

    if (line.includes("=")) {
      const eqIdx = line.indexOf("=");
      const key = line.slice(0, eqIdx).trim();
      if (!key || /\s/.test(key.replace(/[a-zA-Z0-9_.-]/g, ""))) {
        diagnostics.push({ file: filePath, line: i + 1, message: `Invalid key: "${key}"`, severity: "error" });
      }
      const value = line.slice(eqIdx + 1).trim();
      if (value.startsWith('"') && !value.endsWith('"')) {
        diagnostics.push({ file: filePath, line: i + 1, message: "Unclosed string literal", severity: "error" });
      }
    }
  }

  return diagnostics;
}

function lintPython(filePath: string, content: string): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  const lines = content.split("\n");

  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;
  let inTripleQuote = false;
  let tripleChar = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const stripped = line.trimEnd();

    if (inTripleQuote) {
      if (stripped.includes(tripleChar)) inTripleQuote = false;
      continue;
    }

    if (stripped.includes('"""') || stripped.includes("'''")) {
      const tq = stripped.includes('"""') ? '"""' : "'''";
      const count = stripped.split(tq).length - 1;
      if (count % 2 !== 0) {
        inTripleQuote = true;
        tripleChar = tq;
      }
      continue;
    }

    const commentIdx = stripped.indexOf("#");
    const code = commentIdx >= 0 ? stripped.slice(0, commentIdx) : stripped;

    for (const ch of code) {
      if (ch === "(") parenDepth++;
      else if (ch === ")") parenDepth--;
      else if (ch === "[") bracketDepth++;
      else if (ch === "]") bracketDepth--;
      else if (ch === "{") braceDepth++;
      else if (ch === "}") braceDepth--;
    }

    if (parenDepth < 0) {
      diagnostics.push({ file: filePath, line: i + 1, message: "Unmatched closing parenthesis ')'", severity: "error" });
      parenDepth = 0;
    }
    if (bracketDepth < 0) {
      diagnostics.push({ file: filePath, line: i + 1, message: "Unmatched closing bracket ']'", severity: "error" });
      bracketDepth = 0;
    }
    if (braceDepth < 0) {
      diagnostics.push({ file: filePath, line: i + 1, message: "Unmatched closing brace '}'", severity: "error" });
      braceDepth = 0;
    }

    if (/^\s+/.test(line) && !/^\s+/.test(line.replace(/\t/g, "    ")) === false) {
      if (line.includes("\t") && line.includes(" ") && !line.startsWith("#")) {
        const leadingWhitespace = line.match(/^(\s+)/)?.[1] ?? "";
        if (leadingWhitespace.includes("\t") && leadingWhitespace.includes(" ")) {
          diagnostics.push({ file: filePath, line: i + 1, message: "Mixed tabs and spaces in indentation", severity: "warning" });
        }
      }
    }
  }

  if (parenDepth > 0) diagnostics.push({ file: filePath, message: `${parenDepth} unclosed parenthesis(es)`, severity: "error" });
  if (bracketDepth > 0) diagnostics.push({ file: filePath, message: `${bracketDepth} unclosed bracket(s)`, severity: "error" });
  if (braceDepth > 0) diagnostics.push({ file: filePath, message: `${braceDepth} unclosed brace(s)`, severity: "error" });

  return diagnostics;
}
