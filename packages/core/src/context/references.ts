/**
 * Context reference resolver — parse @file:, @url:, @git:, @diff
 * references in user messages and inject resolved content.
 *
 * Inspired by Hermes context_references.py.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

export interface ResolvedReference {
  type: "file" | "url" | "git" | "diff" | "folder";
  ref: string;
  content: string;
  error?: string;
}

const REFERENCE_RE = /@(file|url|git|diff|folder):([^\s]+)/g;

/**
 * Parse and resolve all context references in a user message.
 * Returns both the resolved references and the message with
 * references replaced by their content.
 */
export async function resolveReferences(
  message: string,
  cwd: string = process.cwd(),
  urlFetcher?: (url: string) => Promise<string>,
): Promise<{ references: ResolvedReference[]; resolvedMessage: string }> {
  const references: ResolvedReference[] = [];
  let resolvedMessage = message;

  const matches = [...message.matchAll(REFERENCE_RE)];
  for (const match of matches) {
    const [fullMatch, type, ref] = match;
    const resolved = await resolveOne(type as "file" | "url" | "git" | "diff", ref, cwd, urlFetcher);
    references.push(resolved);

    if (resolved.error) {
      resolvedMessage = resolvedMessage.replace(fullMatch, `[${type}:${ref} ERROR: ${resolved.error}]`);
    } else if (resolved.content) {
      const truncated = resolved.content.length > 8000
        ? resolved.content.slice(0, 6000) + `\n[...${resolved.content.length - 6000} chars truncated...]`
        : resolved.content;
      resolvedMessage = resolvedMessage.replace(fullMatch, `[${type}:${ref}]\n\`\`\`\n${truncated}\n\`\`\``);
    }
  }

  return { references, resolvedMessage };
}

async function resolveOne(
  type: "file" | "url" | "git" | "diff",
  ref: string,
  cwd: string,
  urlFetcher?: (url: string) => Promise<string>,
): Promise<ResolvedReference> {
  try {
    switch (type) {
      case "file":
        return resolveFile(ref, cwd);
      case "url":
        return await resolveUrl(ref, urlFetcher);
      case "git":
        return resolveGit(ref, cwd);
      case "diff":
        return resolveDiff(ref, cwd);
      case "folder":
        return resolveFolder(ref, cwd);
    }
  } catch (err) {
    return { type, ref, content: "", error: (err as Error).message };
  }
}

function resolveFile(ref: string, cwd: string): ResolvedReference {
  const resolved = path.resolve(cwd, ref);
  // Security: prevent path traversal outside cwd
  if (!resolved.startsWith(path.resolve(cwd)) && !resolved.startsWith(process.env.HOME ?? "/")) {
    return { type: "file", ref, content: "", error: "Path traversal blocked" };
  }
  if (!fs.existsSync(resolved)) {
    return { type: "file", ref, content: "", error: "File not found" };
  }
  const stat = fs.statSync(resolved);
  if (stat.size > 500_000) {
    return { type: "file", ref, content: "", error: `File too large (${(stat.size / 1024).toFixed(0)}KB)` };
  }
  const content = fs.readFileSync(resolved, "utf-8");
  return { type: "file", ref, content };
}

async function resolveUrl(ref: string, fetcher?: (url: string) => Promise<string>): Promise<ResolvedReference> {
  if (fetcher) {
    const content = await fetcher(ref);
    return { type: "url", ref, content };
  }
  // Default: simple fetch via built-in fetch
  try {
    const resp = await fetch(ref, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) return { type: "url", ref, content: "", error: `HTTP ${resp.status}` };
    const content = await resp.text();
    return { type: "url", ref, content: content.slice(0, 8000) };
  } catch (err) {
    return { type: "url", ref, content: "", error: (err as Error).message };
  }
}

function resolveGit(ref: string, cwd: string): ResolvedReference {
  // @git:branch — show current diff vs branch
  // @git:hash — show commit
  try {
    const output = execSync(`git show ${ref} --stat --no-color`, {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
    });
    return { type: "git", ref, content: output.slice(0, 8000) };
  } catch (err) {
    return { type: "git", ref, content: "", error: (err as Error).message };
  }
}

function resolveDiff(ref: string, cwd: string): ResolvedReference {
  // @diff:branch — git diff against branch
  // @diff:staged — git diff --cached
  // @diff:unstaged — git diff
  try {
    let cmd: string;
    if (ref === "staged") cmd = "git diff --cached --no-color";
    else if (ref === "unstaged") cmd = "git diff --no-color";
    else cmd = `git diff ${ref} --no-color`;

    const output = execSync(cmd, { cwd, encoding: "utf-8", timeout: 10000 });
    return { type: "diff", ref, content: output.slice(0, 8000) || "(no changes)" };
  } catch (err) {
    return { type: "diff", ref, content: "", error: (err as Error).message };
  }
}

/** @folder: — list directory tree (Hermes context_references.py @folder: type) */
function resolveFolder(ref: string, cwd: string): ResolvedReference {
  const resolved = path.resolve(cwd, ref);
  if (!resolved.startsWith(path.resolve(cwd)) && !resolved.startsWith(process.env.HOME ?? "/")) {
    return { type: "folder", ref, content: "", error: "Path traversal blocked" };
  }
  if (!fs.existsSync(resolved)) {
    return { type: "folder", ref, content: "", error: "Directory not found" };
  }
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) {
    return { type: "folder", ref, content: "", error: "Not a directory — use @file: for files" };
  }

  const lines: string[] = [];
  const MAX_ENTRIES = 200;

  function walk(dir: string, prefix: string, depth: number): void {
    if (depth > 4 || lines.length >= MAX_ENTRIES) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (lines.length >= MAX_ENTRIES) break;
      if (e.name.startsWith(".") || e.name === "node_modules" || e.name === "__pycache__") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        lines.push(`${prefix}${e.name}/`);
        walk(full, prefix + "  ", depth + 1);
      } else {
        lines.push(`${prefix}${e.name}`);
      }
    }
  }

  walk(resolved, "", 0);
  if (lines.length >= MAX_ENTRIES) lines.push(`... (truncated at ${MAX_ENTRIES} entries)`);
  return { type: "folder", ref, content: lines.join("\n") };
}
