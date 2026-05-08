import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import chalk from "chalk";
import { execSync } from "node:child_process";
import { loadConfig, loadEnv, listBuiltinMcpServersByCategory } from "@skeleton/core";

const SKELETON_DIR = path.join(os.homedir(), ".skeleton");
const CONFIG_FILE = path.join(SKELETON_DIR, "skeleton.yaml");

interface CheckResult {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

function icon(status: CheckResult["status"]): string {
  if (status === "ok") return chalk.green("✓");
  if (status === "warn") return chalk.yellow("⚠");
  return chalk.red("✗");
}

export async function runDoctor(): Promise<void> {
  loadEnv();
  const results: CheckResult[] = [];

  // 1. Config file
  if (fs.existsSync(CONFIG_FILE)) {
    results.push({ name: "Config file", status: "ok", detail: CONFIG_FILE });
  } else {
    results.push({ name: "Config file", status: "warn", detail: "Not found. Run `skeleton setup` to create." });
  }

  // 2. API Key
  const apiKey = process.env.SKELETON_API_KEY ?? "";
  if (apiKey) {
    results.push({ name: "API Key", status: "ok", detail: `${apiKey.slice(0, 8)}...` });
  } else {
    results.push({ name: "API Key", status: "fail", detail: "SKELETON_API_KEY not set" });
  }

  // 3. Protocol
  const protocol = process.env.SKELETON_PROTOCOL ?? "";
  if (protocol === "openai" || protocol === "anthropic") {
    results.push({ name: "Protocol", status: "ok", detail: protocol });
  } else {
    try {
      const config = loadConfig();
      if (config.llm.protocol) {
        results.push({ name: "Protocol", status: "ok", detail: config.llm.protocol });
      } else {
        results.push({ name: "Protocol", status: "warn", detail: "Not configured (default: openai)" });
      }
    } catch {
      results.push({ name: "Protocol", status: "warn", detail: "Could not load config" });
    }
  }

  // 4. Base URL
  try {
    const config = loadConfig();
    if (config.llm.baseUrl) {
      results.push({ name: "Base URL", status: "ok", detail: config.llm.baseUrl });
    } else {
      results.push({ name: "Base URL", status: "warn", detail: "Not configured" });
    }
  } catch {
    results.push({ name: "Base URL", status: "fail", detail: "Config load failed" });
  }

  // 5. Model
  try {
    const config = loadConfig();
    results.push({ name: "Model", status: config.llm.model ? "ok" : "warn", detail: config.llm.model || "Not set" });
  } catch {
    results.push({ name: "Model", status: "fail", detail: "Config load failed" });
  }

  // 6. ~/.skeleton directory
  if (fs.existsSync(SKELETON_DIR)) {
    const entries = fs.readdirSync(SKELETON_DIR);
    results.push({ name: "Data dir", status: "ok", detail: `${SKELETON_DIR} (${entries.length} entries)` });
  } else {
    results.push({ name: "Data dir", status: "warn", detail: `${SKELETON_DIR} does not exist` });
  }

  // 7. SQLite (for SessionDB, MemoryStore)
  try {
    require.resolve("better-sqlite3");
    results.push({ name: "SQLite (better-sqlite3)", status: "ok", detail: "Available" });
  } catch {
    results.push({ name: "SQLite (better-sqlite3)", status: "fail", detail: "Not installed" });
  }

  // 8. WABT (for WASM RE)
  try {
    const v = execSync("wasm2wat --version 2>&1", { encoding: "utf-8" }).trim();
    results.push({ name: "WABT", status: "ok", detail: v.split("\n")[0] });
  } catch {
    results.push({ name: "WABT", status: "warn", detail: "Not installed (optional, for wasm-reverse skill)" });
  }

  // 9. Radare2
  try {
    const v = execSync("r2 -v 2>&1", { encoding: "utf-8" }).trim();
    results.push({ name: "Radare2", status: "ok", detail: v.split("\n")[0] });
  } catch {
    results.push({ name: "Radare2", status: "warn", detail: "Not installed (optional, for r2 MCP)" });
  }

  // 10. MCP env vars
  const mcpEnvVars = Object.keys(process.env).filter((k) => k.startsWith("SKELETON_MCP_") && process.env[k] === "true");
  if (mcpEnvVars.length > 0) {
    results.push({ name: "MCP servers (env)", status: "ok", detail: `${mcpEnvVars.length} enabled: ${mcpEnvVars.map((k) => k.replace("SKELETON_MCP_", "")).join(", ")}` });
  } else {
    results.push({ name: "MCP servers (env)", status: "ok", detail: "None enabled via env (use skeleton.yaml or env vars)" });
  }

  // 11. Node version
  results.push({ name: "Node.js", status: "ok", detail: process.version });

  // 12. Platform
  results.push({ name: "Platform", status: "ok", detail: `${process.platform} ${os.release()}` });

  // Print results
  console.log(chalk.cyan("\n  Skeleton Doctor — Diagnostic Report\n"));

  for (const r of results) {
    console.log(`  ${icon(r.status)} ${chalk.bold(r.name)}: ${r.detail}`);
  }

  const fails = results.filter((r) => r.status === "fail").length;
  const warns = results.filter((r) => r.status === "warn").length;

  console.log();
  if (fails > 0) {
    console.log(chalk.red(`  ${fails} issue(s) found. Fix them before running Skeleton.`));
  } else if (warns > 0) {
    console.log(chalk.yellow(`  ${warns} warning(s). Skeleton can run but some features may be unavailable.`));
  } else {
    console.log(chalk.green("  All checks passed. Skeleton is ready."));
  }
  console.log();
}
