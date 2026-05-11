import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createWriteStream, type WriteStream } from "node:fs";
import { redactSensitiveText } from "../redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Centralized logging to ~/.skeleton/logs/
 * - agent.log — INFO+ (all non-debug)
 * - errors.log — WARN+ (warnings and errors only)
 * - <date>.log — daily rotation (legacy project-local, opt-in via logDir override)
 */

const DEFAULT_LOG_DIR = path.join(os.homedir(), ".skeleton", "logs");
const MAX_LOG_SIZE = 10 * 1024 * 1024; // 10MB — rotate when exceeded

export class Logger {
  private prefix: string;
  private minLevel: LogLevel;
  private logDir: string;
  private agentStream: WriteStream | null = null;
  private errorStream: WriteStream | null = null;

  constructor(prefix: string, opts?: { level?: LogLevel; logDir?: string }) {
    this.prefix = prefix;
    this.minLevel = opts?.level ?? (process.env.SKELETON_LOG_LEVEL as LogLevel) ?? "info";
    this.logDir = opts?.logDir ?? DEFAULT_LOG_DIR;
    try {
      fs.mkdirSync(this.logDir, { recursive: true });
    } catch { /* non-critical */ }
  }

  debug(msg: string, meta?: Record<string, unknown>): void { this.write("debug", msg, meta); }
  info(msg: string, meta?: Record<string, unknown>): void { this.write("info", msg, meta); }
  warn(msg: string, meta?: Record<string, unknown>): void { this.write("warn", msg, meta); }
  error(msg: string, meta?: Record<string, unknown>): void { this.write("error", msg, meta); }

  private write(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;

    const safeMsg = redactSensitiveText(msg);
    const safeMeta = meta ? Object.fromEntries(
      Object.entries(meta).map(([k, v]) => [k, typeof v === "string" ? redactSensitiveText(v) : v]),
    ) : undefined;
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      prefix: this.prefix,
      msg: safeMsg,
      ...safeMeta,
    }) + "\n";

    this.ensureStreams();
    this.agentStream?.write(entry);
    if (LEVEL_ORDER[level] >= LEVEL_ORDER.warn) {
      this.errorStream?.write(entry);
    }
    this.rotateIfLarge();
  }

  private ensureStreams(): void {
    if (!this.agentStream) {
      try {
        this.agentStream = createWriteStream(path.join(this.logDir, "agent.log"), { flags: "a" });
      } catch { /* ignore */ }
    }
    if (!this.errorStream) {
      try {
        this.errorStream = createWriteStream(path.join(this.logDir, "errors.log"), { flags: "a" });
      } catch { /* ignore */ }
    }
  }

  private rotateIfLarge(): void {
    try {
      const agentPath = path.join(this.logDir, "agent.log");
      if (fs.existsSync(agentPath) && fs.statSync(agentPath).size > MAX_LOG_SIZE) {
        this.agentStream?.end();
        this.agentStream = null;
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        fs.renameSync(agentPath, path.join(this.logDir, `agent.${ts}.log`));
      }
      const errorPath = path.join(this.logDir, "errors.log");
      if (fs.existsSync(errorPath) && fs.statSync(errorPath).size > MAX_LOG_SIZE) {
        this.errorStream?.end();
        this.errorStream = null;
        const ts = new Date().toISOString().replace(/[:.]/g, "-");
        fs.renameSync(errorPath, path.join(this.logDir, `errors.${ts}.log`));
      }
    } catch { /* non-critical */ }
  }

  close(): void {
    this.agentStream?.end();
    this.errorStream?.end();
    this.agentStream = null;
    this.errorStream = null;
  }
}

/** Read last N lines from a log file (for `skeleton logs` command) */
export function tailLog(file: "agent" | "errors", lines = 50, logDir?: string): string[] {
  const dir = logDir ?? DEFAULT_LOG_DIR;
  const filePath = path.join(dir, `${file}.log`);
  if (!fs.existsSync(filePath)) return [];
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const allLines = content.split("\n").filter(Boolean);
    return allLines.slice(-lines);
  } catch {
    return [];
  }
}

/** Filter log lines by level/prefix/text for `skeleton logs --grep` */
export function filterLog(
  file: "agent" | "errors",
  filter: { level?: LogLevel; prefix?: string; grep?: string },
  limit = 100,
  logDir?: string,
): string[] {
  const dir = logDir ?? DEFAULT_LOG_DIR;
  const filePath = path.join(dir, `${file}.log`);
  if (!fs.existsSync(filePath)) return [];

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const allLines = content.split("\n").filter(Boolean);
    const matched: string[] = [];

    for (let i = allLines.length - 1; i >= 0 && matched.length < limit; i--) {
      const line = allLines[i];
      try {
        const parsed = JSON.parse(line);
        if (filter.level && parsed.level !== filter.level) continue;
        if (filter.prefix && parsed.prefix !== filter.prefix) continue;
        if (filter.grep && !line.includes(filter.grep)) continue;
        matched.push(line);
      } catch { /* skip malformed */ }
    }

    return matched.reverse();
  } catch {
    return [];
  }
}

export function getLogDir(): string {
  return DEFAULT_LOG_DIR;
}
