import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import chalk from "chalk";
import { execSync } from "node:child_process";
import {
  loadConfig,
  listBuiltinMcpServersByCategory,
  findProvider,
  listProviders,
  getSkeletonEnvPath,
} from "@skeleton/core";

const SKELETON_DIR = path.join(os.homedir(), ".skeleton");
const CONFIG_FILE = path.join(SKELETON_DIR, "config.json");
const ENV_FILE = getSkeletonEnvPath();

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
  const results: CheckResult[] = [];

  // 1. ~/.skeleton directory
  if (fs.existsSync(SKELETON_DIR)) {
    const entries = fs.readdirSync(SKELETON_DIR);
    results.push({
      name: "Data dir",
      status: "ok",
      detail: `${SKELETON_DIR} (${entries.length} entries)`,
    });
  } else {
    results.push({
      name: "Data dir",
      status: "warn",
      detail: `${SKELETON_DIR} does not exist. Run \`skeleton setup\`.`,
    });
  }

  // 2. config.json
  if (fs.existsSync(CONFIG_FILE)) {
    results.push({ name: "Config file", status: "ok", detail: CONFIG_FILE });
  } else {
    results.push({
      name: "Config file",
      status: "warn",
      detail: "Not found. Run `skeleton setup` to create.",
    });
  }

  // 3. .env (secrets)
  if (fs.existsSync(ENV_FILE)) {
    const envKeys = fs
      .readFileSync(ENV_FILE, "utf-8")
      .split("\n")
      .filter((l) => l.trim() && !l.startsWith("#"))
      .map((l) => l.split("=")[0]?.trim())
      .filter(Boolean);
    results.push({
      name: "Secrets (.env)",
      status: "ok",
      detail: `${ENV_FILE} (${envKeys.length} key(s): ${envKeys.join(", ")})`,
    });
  } else {
    results.push({
      name: "Secrets (.env)",
      status: "warn",
      detail: "No ~/.skeleton/.env found. API keys may need to be set via env vars.",
    });
  }

  // 4. Provider resolution
  try {
    const config = loadConfig();
    const providerName = (config.llm as any).provider;

    if (providerName) {
      const profile = findProvider(providerName);
      if (profile) {
        results.push({
          name: "Provider",
          status: "ok",
          detail: `${profile.name} → ${profile.baseUrl}`,
        });
      } else {
        results.push({
          name: "Provider",
          status: "fail",
          detail: `"${providerName}" not found in provider registry`,
        });
      }
    } else {
      results.push({
        name: "Provider",
        status: "warn",
        detail: "No provider set (using manual protocol/baseUrl config)",
      });
    }
  } catch {
    results.push({
      name: "Provider",
      status: "fail",
      detail: "Could not load config",
    });
  }

  // 5. API Key (check via provider's env var resolution)
  try {
    const config = loadConfig();
    if (config.llm.apiKey) {
      results.push({
        name: "API Key",
        status: "ok",
        detail: `${config.llm.apiKey.slice(0, 8)}***`,
      });
    } else {
      // Check if provider expects a key
      const providerName = (config.llm as any).provider;
      const profile = providerName ? findProvider(providerName) : null;
      if (profile?.quirks?.skipApiKey) {
        results.push({
          name: "API Key",
          status: "ok",
          detail: "Not required for this provider",
        });
      } else {
        const expectedVar = profile?.apiKeyEnvVars[0] ?? "SKELETON_API_KEY";
        results.push({
          name: "API Key",
          status: "fail",
          detail: `Not set. Expected ${expectedVar} in env or ~/.skeleton/.env`,
        });
      }
    }
  } catch {
    results.push({ name: "API Key", status: "fail", detail: "Config load failed" });
  }

  // 6. Base URL
  try {
    const config = loadConfig();
    if (config.llm.baseUrl) {
      results.push({
        name: "Base URL",
        status: "ok",
        detail: config.llm.baseUrl,
      });
    } else {
      results.push({ name: "Base URL", status: "warn", detail: "Not configured" });
    }
  } catch {
    results.push({ name: "Base URL", status: "fail", detail: "Config load failed" });
  }

  // 7. Model
  try {
    const config = loadConfig();
    results.push({
      name: "Model",
      status: config.llm.model ? "ok" : "warn",
      detail: config.llm.model || "Not set",
    });
  } catch {
    results.push({ name: "Model", status: "fail", detail: "Config load failed" });
  }

  // 8. Fallback config
  try {
    const config = loadConfig();
    if (config.fallback) {
      const fbProvider = (config.fallback as any).provider;
      results.push({
        name: "Fallback",
        status: "ok",
        detail: fbProvider
          ? `${fbProvider} / ${config.fallback.model}`
          : `${config.fallback.protocol} / ${config.fallback.model}`,
      });
    } else {
      results.push({
        name: "Fallback",
        status: "ok",
        detail: "Not configured (optional)",
      });
    }
  } catch {
    // ignore
  }

  // 9. Available providers
  const providerCount = listProviders().length;
  results.push({
    name: "Provider registry",
    status: "ok",
    detail: `${providerCount} providers registered`,
  });

  // 10. SQLite
  try {
    require.resolve("better-sqlite3");
    results.push({
      name: "SQLite (better-sqlite3)",
      status: "ok",
      detail: "Available",
    });
  } catch {
    results.push({
      name: "SQLite (better-sqlite3)",
      status: "fail",
      detail: "Not installed",
    });
  }

  // 11. MCP env vars
  const mcpEnvVars = Object.keys(process.env).filter(
    (k) => k.startsWith("SKELETON_MCP_") && process.env[k] === "true",
  );
  if (mcpEnvVars.length > 0) {
    results.push({
      name: "MCP servers (env)",
      status: "ok",
      detail: `${mcpEnvVars.length} enabled: ${mcpEnvVars.map((k) => k.replace("SKELETON_MCP_", "")).join(", ")}`,
    });
  } else {
    results.push({
      name: "MCP servers (env)",
      status: "ok",
      detail: "None enabled via env (use config.json or env vars)",
    });
  }

  // 12. Node version
  results.push({ name: "Node.js", status: "ok", detail: process.version });

  // 13. Platform
  results.push({
    name: "Platform",
    status: "ok",
    detail: `${process.platform} ${os.release()}`,
  });

  // Print results
  console.log(chalk.cyan("\n  ◆ Skeleton Doctor — Diagnostic Report\n"));

  for (const r of results) {
    console.log(`  ${icon(r.status)} ${chalk.bold(r.name)}: ${r.detail}`);
  }

  const fails = results.filter((r) => r.status === "fail").length;
  const warns = results.filter((r) => r.status === "warn").length;

  console.log();
  if (fails > 0) {
    console.log(
      chalk.red(`  ${fails} issue(s) found. Fix them before running Skeleton.`),
    );
    console.log(
      chalk.gray("  Run `skeleton setup` to configure providers and API keys."),
    );
  } else if (warns > 0) {
    console.log(
      chalk.yellow(
        `  ${warns} warning(s). Skeleton can run but some features may be unavailable.`,
      ),
    );
  } else {
    console.log(chalk.green("  All checks passed. Skeleton is ready."));
  }
  console.log();
}
