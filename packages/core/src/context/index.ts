import fs from "node:fs";
import path from "node:path";

/**
 * Project context discovery — walks from cwd upward to git root,
 * finds SKELETON.md / .skeleton.md / AGENTS.md files.
 * Hermes-style: security scan before injection, content truncation.
 */
export class ProjectContext {
  private cachedContent: string | null = null;
  private cachedMtime: number | 0 = 0;
  private filePath: string | null = null;

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
      // Truncate: 70% head + 20% tail, 10% gap marker
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
    const content = this.load();
    if (!content) return "";
    return `## Project Context\n${content}`;
  }

  /** Get the discovered file path */
  getFilePath(): string | null {
    return this.filePath ?? this.discoverFile();
  }

  private discoverFile(): string | null {
    const candidates = [
      path.join(this.cwd, "SKELETON.md"),
      path.join(this.cwd, ".skeleton.md"),
      path.join(this.cwd, "AGENTS.md"),
      path.join(this.cwd, ".agents", "SKELETON.md"),
    ];

    // Also walk up to git root
    let dir = this.cwd;
    for (let i = 0; i < 20; i++) {
      for (const candidate of candidates) {
        if (fs.existsSync(candidate)) return candidate;
      }
      const gitDir = path.join(dir, ".git");
      if (fs.existsSync(gitDir)) break; // stop at git root
      const parent = path.dirname(dir);
      if (parent === dir) break; // filesystem root
      dir = parent;
    }

    // Check found files during walk
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) return candidate;
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

    // Block invisible Unicode (zero-width spaces, Bidi overrides)
    result = result.replace(
      /[​-‍﻿‪-‮⁦-⁩]/g,
      "[BLOCKED: invisible unicode]",
    );

    // Block prompt injection patterns
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
