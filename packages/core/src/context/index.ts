import fs from "node:fs";
import path from "node:path";

/**
 * Project context discovery — walks from cwd upward to git root,
 * finds SKELETON.md / .skeleton.md / AGENTS.md files.
 *
 * Enhanced: subdirectory progressive discovery — as the agent
 * navigates the codebase (via terminal or file tools), context
 * files in deeper directories are discovered and injected.
 * Inspired by Hermes subdirectory_hints.py.
 */

const CONTEXT_FILENAMES = [
  "SKELETON.md",
  ".skeleton.md",
  "AGENTS.md",
  ".agents",
  "CLAUDE.md",
  ".claude",
  ".cursorrules",
];

const MAX_SUBDIR_CONTEXTS = 5;
const MAX_TOTAL_CONTEXT_SIZE = 30_000; // 30KB total budget for subdirectory contexts

export class ProjectContext {
  private cachedContent: string | null = null;
  private cachedMtime: number | 0 = 0;
  private filePath: string | null = null;
  private subdirectoryContexts = new Map<string, { content: string; mtime: number }>();
  private lastVisitedDir: string | null = null;
  /** Pending hints to inject into the next tool result (cleared after getSubdirectoryHint). */
  private pendingHints: string[] = [];

  constructor(private cwd: string = process.cwd()) {}

  /** Discover and load project context files */
  load(): string {
    const discovered = this.discoverFile();
    if (!discovered) return "";

    // Cache invalidation: check mtime
    const stat = fs.statSync(discovered);
    if (this.filePath === discovered && this.cachedMtime === stat.mtimeMs && this.cachedContent) {
      return this.cachedContent;
    }

    let raw = fs.readFileSync(discovered, "utf-8");
    raw = this.stripFrontmatter(raw);
    raw = this.scanContent(raw);

    if (raw.length > 20_000) {
      const headLen = Math.floor(raw.length * 0.7);
      const tailLen = Math.floor(raw.length * 0.2);
      raw = raw.slice(0, headLen) + "\n\n[... truncated ...]\n\n" + raw.slice(raw.length - tailLen);
    }

    this.cachedContent = raw;
    this.cachedMtime = stat.mtimeMs;
    this.filePath = discovered;
    return raw;
  }

  /** Build project context for system prompt injection */
  buildContext(): string {
    const parts: string[] = [];

    // Root-level context
    const rootContent = this.load();
    if (rootContent) {
      parts.push(`## Project Context\n${rootContent}`);
    }

    // Subdirectory contexts (progressive discovery)
    const subContexts = this.buildSubdirectoryContext();
    if (subContexts) {
      parts.push(subContexts);
    }

    return parts.join("\n\n");
  }

  /**
   * Notify the context system of a directory the agent is working in.
   * This triggers progressive discovery of context files in that directory.
   */
  notifyDirectoryVisit(dirPath: string): void {
    if (!fs.existsSync(dirPath)) return;
    const resolved = path.resolve(dirPath);
    if (resolved === this.lastVisitedDir) return;
    this.lastVisitedDir = resolved;

    // Don't discover in the root (already covered) or parent of root
    if (resolved === path.resolve(this.cwd) || resolved === path.dirname(path.resolve(this.cwd))) return;

    for (const filename of CONTEXT_FILENAMES) {
      const filePath = path.join(resolved, filename);
      if (isReadableFile(filePath)) {
        this.discoverSubdirectoryContext(resolved, filePath);
      }
    }
  }

  /** Get the discovered file path */
  getFilePath(): string | null {
    return this.filePath ?? this.discoverFile();
  }

  /** Build subdirectory context from discovered files */
  private buildSubdirectoryContext(): string {
    if (this.subdirectoryContexts.size === 0) return "";

    const entries = [...this.subdirectoryContexts.entries()]
      .slice(-MAX_SUBDIR_CONTEXTS); // Keep most recent

    let totalSize = 0;
    const parts: string[] = [];

    for (const [dir, { content }] of entries) {
      const relDir = path.relative(this.cwd, dir) || dir;
      if (totalSize + content.length > MAX_TOTAL_CONTEXT_SIZE) {
        parts.push(`### ./${relDir}/ [context file found but truncated due to budget]`);
        break;
      }
      parts.push(`### ./${relDir}/\n${content}`);
      totalSize += content.length;
    }

    return parts.length > 0
      ? `## Subdirectory Contexts (auto-discovered)\n${parts.join("\n\n")}`
      : "";
  }

  /** Discover and cache a context file in a subdirectory */
  private discoverSubdirectoryContext(dir: string, filePath: string): void {
    const existing = this.subdirectoryContexts.get(dir);
    try {
      const stat = fs.statSync(filePath);
      if (existing && existing.mtime === stat.mtimeMs) return; // Unchanged

      let content = fs.readFileSync(filePath, "utf-8");
      content = this.stripFrontmatter(content);
      content = this.scanContent(content);
      if (content.length > 4000) {
        content = content.slice(0, 3000) + "\n[...truncated...]";
      }

      this.subdirectoryContexts.set(dir, { content, mtime: stat.mtimeMs });

      // Queue as pending hint for injection into next tool result
      // (Hermes SubdirectoryHintTracker: inject into tool result, not system prompt)
      const relDir = path.relative(this.cwd, dir) || dir;
      this.pendingHints.push(`[Subdirectory context discovered: ./${relDir}/]\n${content}`);
    } catch {
      // Ignore read errors
    }
  }

  /**
   * Return pending subdirectory hints and clear the queue.
   * Called by agent.ts after each tool execution to inject hints into the
   * tool result (Hermes SubdirectoryHintTracker pattern — preserves prefix cache).
   */
  getSubdirectoryHint(): string | null {
    if (this.pendingHints.length === 0) return null;
    const hint = this.pendingHints.join("\n\n");
    this.pendingHints = [];
    return hint;
  }

  private discoverFile(): string | null {
    const candidates = CONTEXT_FILENAMES.map(f => path.join(this.cwd, f));

    // Walk up to git root
    let dir = this.cwd;
    for (let i = 0; i < 20; i++) {
      for (const candidate of candidates) {
        if (isReadableFile(candidate)) return candidate;
      }
      const gitDir = path.join(dir, ".git");
      if (fs.existsSync(gitDir)) break;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    for (const candidate of candidates) {
      if (isReadableFile(candidate)) return candidate;
    }
    return null;
  }

  /** Strip YAML frontmatter (---...---) */
  private stripFrontmatter(content: string): string {
    return content.replace(/^---\n[\s\S]*?\n---\n*/, "");
  }

  /** Security scan: detect invisible Unicode, prompt injection, credential exfiltration */
  private scanContent(content: string): string {
    let result = content;

    result = result.replace(
      /[​-‍﻿‪-‮⁦-⁩]/g,
      "[BLOCKED: invisible unicode]",
    );

    const injectionPatterns = [
      /ignore\s+(previous|above|prior)\s+(instructions?|prompt)/gi,
      /system\s+prompt\s+override/gi,
      /<!--.*?-->/g,
      /curl\s+[^\s]*\|.*sh/gi,
      /<(script|iframe|embed|object)/gi,
    ];

    for (const pattern of injectionPatterns) {
      result = result.replace(pattern, "[BLOCKED: potential injection]");
    }

    return result;
  }
}

// Some candidates like `.claude` / `.agents` may exist as directories on disk;
// `existsSync` returns true for those but `readFileSync` then throws EISDIR.
// This helper guarantees the path is a readable regular file before we try
// to open it.
function isReadableFile(p: string): boolean {
  try {
    const stat = fs.statSync(p);
    return stat.isFile();
  } catch {
    return false;
  }
}
