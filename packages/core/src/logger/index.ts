import fs from "node:fs";
import path from "node:path";
import { createWriteStream, type WriteStream } from "node:fs";
import { redactSensitiveText } from "../redact.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export class Logger {
  private prefix: string;
  private minLevel: LogLevel;
  private logDir: string;
  private stream: WriteStream | null = null;
  private currentDate = "";

  constructor(prefix: string, opts?: { level?: LogLevel; logDir?: string }) {
    this.prefix = prefix;
    this.minLevel = opts?.level ?? (process.env.SKELETON_LOG_LEVEL as LogLevel) ?? "info";
    this.logDir = opts?.logDir ?? path.join(process.cwd(), ".skeleton", "logs");
    fs.mkdirSync(this.logDir, { recursive: true });
  }

  debug(msg: string, meta?: Record<string, unknown>): void { this.write("debug", msg, meta); }
  info(msg: string, meta?: Record<string, unknown>): void { this.write("info", msg, meta); }
  warn(msg: string, meta?: Record<string, unknown>): void { this.write("warn", msg, meta); }
  error(msg: string, meta?: Record<string, unknown>): void { this.write("error", msg, meta); }

  private write(level: LogLevel, msg: string, meta?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.minLevel]) return;
    // Redact secrets from log messages
    const safeMsg = redactSensitiveText(msg);
    const safeMeta = meta ? Object.fromEntries(
      Object.entries(meta).map(([k, v]) => [k, typeof v === "string" ? redactSensitiveText(v) : v]),
    ) : undefined;
    const entry = JSON.stringify({ ts: new Date().toISOString(), level, prefix: this.prefix, msg: safeMsg, ...safeMeta });
    this.rotate();
    this.stream?.write(entry + "\n");
  }

  private rotate(): void {
    const today = new Date().toISOString().slice(0, 10);
    if (today === this.currentDate) return;
    this.currentDate = today;
    this.stream?.end();
    this.stream = createWriteStream(path.join(this.logDir, `${today}.log`), { flags: "a" });
  }

  close(): void {
    this.stream?.end();
    this.stream = null;
  }
}
