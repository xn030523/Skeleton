/**
 * Simple JSON config — Claude Code style.
 *
 * Single file: ~/.skeleton/config.json
 * Minimal fields: baseUrl, apiKey, model
 * /login command writes this interactively.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SKELETON_DIR = path.join(os.homedir(), ".skeleton");
const CONFIG_PATH = path.join(SKELETON_DIR, "config.json");

export interface SimpleConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Fast/cheap model for auxiliary tasks (compression, titles) */
  haiku?: string;
  /** Strong model for complex tasks */
  opus?: string;
  /** Provider hint (openai | anthropic | auto) */
  protocol?: "openai" | "anthropic";
  /** Provider name for resolution (deepseek, anthropic, gpt, etc.) */
  provider?: string;
  /** Telegram bot token */
  telegramToken?: string;
  /** MCP server config — keyed by server name */
  mcp?: Record<string, { enabled?: boolean; command?: string; args?: string[]; env?: Record<string, string>; url?: string }>;
}

/** Read config.json. Returns null if not found. */
export function readSimpleConfig(): SimpleConfig | null {
  if (!fs.existsSync(CONFIG_PATH)) return null;
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    if (!parsed.baseUrl || !parsed.apiKey || !parsed.model) return null;
    return parsed as SimpleConfig;
  } catch {
    return null;
  }
}

/** Write config.json. Creates ~/.skeleton/ if needed. */
export function writeSimpleConfig(config: SimpleConfig): void {
  fs.mkdirSync(SKELETON_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

/** Check if simple config exists */
export function hasSimpleConfig(): boolean {
  return fs.existsSync(CONFIG_PATH);
}

/** Get config path for display */
export function getSimpleConfigPath(): string {
  return CONFIG_PATH;
}

/**
 * Get a config value — checks config.json first, then falls back to env var.
 * This is the single entry point for all config reads across the codebase.
 */
export function getConfigValue(key: string): string {
  const config = readSimpleConfig();
  if (config) {
    // Map known keys to JSON fields
    const map: Record<string, string | undefined> = {
      SKELETON_API_KEY: config.apiKey,
      SKELETON_BASE_URL: config.baseUrl,
      SKELETON_MODEL: config.model,
      SKELETON_PROTOCOL: config.protocol,
      SKELETON_TG_TOKEN: config.telegramToken,
      // Additional keys stored in config.json under "keys" object
      ...((config as any).keys ?? {}),
    };
    const val = map[key];
    if (val) return val;
  }
  // Fallback to environment variable
  return process.env[key] ?? "";
}

/** Convert simple config to the LLMConfig format used by Agent */
export function simpleConfigToLLM(config: SimpleConfig): {
  protocol: "openai" | "anthropic";
  apiKey: string;
  baseUrl: string;
  model: string;
} {
  // Auto-detect protocol from baseUrl
  let protocol: "openai" | "anthropic" = config.protocol ?? "openai";
  if (config.baseUrl.includes("anthropic.com")) {
    protocol = "anthropic";
  }
  return {
    protocol,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
  };
}
