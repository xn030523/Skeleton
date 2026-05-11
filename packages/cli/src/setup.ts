/**
 * Skeleton Setup Wizard — interactive configuration.
 *
 * Writes to: ~/.skeleton/config.json
 * Single JSON file with baseUrl, apiKey, model.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import chalk from "chalk";
import readline from "node:readline";
import {
  listProviders,
  findProvider,
  MCP_CATEGORIES,
  writeSimpleConfig,
  writeSkeletonEnv,
  getSkeletonEnvPath,
} from "@skeleton/core";
import type { ProviderProfile } from "@skeleton/core";

const SKELETON_DIR = path.join(os.homedir(), ".skeleton");
const CONFIG_FILE = path.join(SKELETON_DIR, "config.json");

function question(rl: readline.Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => resolve(answer.trim()));
  });
}

function questionChoice(
  rl: readline.Interface,
  prompt: string,
  choices: string[],
  defaultIdx: number = 0,
): Promise<string> {
  const display = choices
    .map((c, i) =>
      i === defaultIdx
        ? chalk.cyan(`[${i + 1}]`) + ` ${c}`
        : `(${i + 1}) ${c}`,
    )
    .join("  ");
  return question(rl, `${prompt} ${display} `).then((ans) => {
    const idx = parseInt(ans) - 1;
    if (idx >= 0 && idx < choices.length) return choices[idx];
    return choices[defaultIdx];
  });
}

export async function runSetup(): Promise<void> {
  console.log(chalk.cyan("\n  ◆ Skeleton Setup Wizard\n"));
  console.log(chalk.gray("  Configure your AI provider and API keys.\n"));

  if (!fs.existsSync(SKELETON_DIR)) {
    fs.mkdirSync(SKELETON_DIR, { recursive: true });
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  // ── 1. Provider selection ───────────────────────────────────────
  const providers = listProviders().sort((a, b) =>
    a.name.localeCompare(b.name),
  );

  // Group providers by tier for display
  const tier1 = providers.filter((p) =>
    ["openai", "anthropic", "gemini", "azure-foundry"].includes(p.name),
  );
  const tier2 = providers.filter((p) =>
    [
      "deepseek",
      "alibaba",
      "alibaba-coding",
      "minimax",
      "kimi-coding",
      "stepfun",
      "xiaomi",
    ].includes(p.name),
  );
  const tier3 = providers.filter((p) =>
    ["openrouter", "ai-gateway"].includes(p.name),
  );
  const tierLocal = providers.filter((p) =>
    ["ollama", "lm-studio"].includes(p.name),
  );
  const tierOther = providers.filter(
    (p) =>
      !tier1.includes(p) &&
      !tier2.includes(p) &&
      !tier3.includes(p) &&
      !tierLocal.includes(p),
  );

  console.log(chalk.cyan("  Available providers:\n"));

  const printTier = (label: string, list: ProviderProfile[]) => {
    console.log(chalk.gray(`  ${label}:`));
    for (const p of list) {
      const aliasStr =
        p.aliases.length > 0
          ? chalk.gray(` (${p.aliases.join(", ")})`)
          : "";
      const keyHint = p.quirks?.skipApiKey
        ? chalk.gray(" [no key needed]")
        : chalk.gray(` [${p.apiKeyEnvVars[0] ?? "API_KEY"}]`);
      console.log(
        `    ${chalk.white(p.name.padEnd(18))}${aliasStr}${keyHint}`,
      );
    }
    console.log();
  };

  if (tier1.length > 0) printTier("Major cloud", tier1);
  if (tier2.length > 0) printTier("Chinese providers", tier2);
  if (tier3.length > 0) printTier("Routers / aggregators", tier3);
  if (tierLocal.length > 0) printTier("Local / self-hosted", tierLocal);
  if (tierOther.length > 0) printTier("Other", tierOther);

  const providerInput = await question(
    rl,
    chalk.cyan("  Provider") +
      chalk.gray(" (name or alias, e.g. deepseek, claude, gpt): ") +
      chalk.cyan(""),
  );

  const profile = findProvider(providerInput);
  if (!profile) {
    console.log(
      chalk.red(`\n  ✗ Unknown provider "${providerInput}". Run setup again.`),
    );
    rl.close();
    return;
  }

  console.log(
    chalk.green(`\n  ✓ Provider: ${profile.name}`) +
      chalk.gray(` → ${profile.baseUrl}`),
  );

  // ── 2. API Key ───────────────────────────────────────────────────
  const envEntries: Record<string, string> = {};
  const apiKeyEnvVar = profile.apiKeyEnvVars[0] ?? "API_KEY";

  if (!profile.quirks?.skipApiKey) {
    // Check if key already exists in env
    let existingKey = "";
    for (const envVar of profile.apiKeyEnvVars) {
      if (process.env[envVar]) {
        existingKey = process.env[envVar]!;
        break;
      }
    }

    // Check if key exists in ~/.skeleton/.env
    const skeletonEnvPath = getSkeletonEnvPath();
    if (!existingKey && fs.existsSync(skeletonEnvPath)) {
      for (const line of fs.readFileSync(skeletonEnvPath, "utf-8").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const val = trimmed.slice(eq + 1).trim();
        if (profile.apiKeyEnvVars.includes(key) && val) {
          existingKey = val;
          break;
        }
      }
    }

    if (existingKey) {
      console.log(
        chalk.gray(
          `  API Key: ${existingKey.slice(0, 8)}*** (from ${apiKeyEnvVar})`,
        ),
      );
      envEntries[apiKeyEnvVar] = existingKey;
    } else {
      const apiKey = await question(
        rl,
        chalk.cyan(`  ${apiKeyEnvVar}: `),
      );
      if (apiKey) {
        envEntries[apiKeyEnvVar] = apiKey;
      } else {
        console.log(
          chalk.yellow("  ⚠ No API key provided. You can set it later."),
        );
      }
    }
  } else {
    console.log(chalk.gray("  No API key required for this provider."));
  }

  // ── 3. Model ────────────────────────────────────────────────────
  const defaultModel = profile.defaultModel;
  const modelInput =
    (await question(
      rl,
      chalk.cyan("  Model") + chalk.gray(` [${defaultModel}]: `),
    )) || defaultModel;

  // ── 4. Fallback provider (optional) ─────────────────────────────
  console.log(
    chalk.gray(
      "\n  Optionally configure a fallback provider (used if primary fails).",
    ),
  );
  const wantFallback = await questionChoice(
    rl,
    "  Add fallback provider?",
    ["no", "yes"],
    0,
  );

  let fallbackProfile: ProviderProfile | null = null;
  let fallbackEnvEntries: Record<string, string> = {};
  let fallbackModel = "";

  if (wantFallback === "yes") {
    const fbInput = await question(
      rl,
      chalk.cyan("  Fallback provider") + chalk.gray(" (name or alias): "),
    );
    fallbackProfile = findProvider(fbInput);

    if (fallbackProfile) {
      console.log(
        chalk.green(`  ✓ Fallback: ${fallbackProfile.name}`) +
          chalk.gray(` → ${fallbackProfile.baseUrl}`),
      );

      if (!fallbackProfile.quirks?.skipApiKey) {
        const fbKeyEnvVar = fallbackProfile.apiKeyEnvVars[0] ?? "API_KEY";
        let fbExistingKey = "";
        for (const envVar of fallbackProfile.apiKeyEnvVars) {
          if (process.env[envVar]) {
            fbExistingKey = process.env[envVar]!;
            break;
          }
        }
        if (fbExistingKey) {
          console.log(
            chalk.gray(
              `  API Key: ${fbExistingKey.slice(0, 8)}*** (from ${fbKeyEnvVar})`,
            ),
          );
          fallbackEnvEntries[fbKeyEnvVar] = fbExistingKey;
        } else {
          const fbKey = await question(
            rl,
            chalk.cyan(`  ${fbKeyEnvVar}: `),
          );
          if (fbKey) {
            fallbackEnvEntries[fbKeyEnvVar] = fbKey;
          }
        }
      }

      fallbackModel =
        (await question(
          rl,
          chalk.cyan("  Fallback model") +
            chalk.gray(` [${fallbackProfile.defaultModel}]: `),
        )) || fallbackProfile.defaultModel;
    } else {
      console.log(chalk.yellow(`  ⚠ Unknown provider "${fbInput}". Skipping.`));
    }
  }

  // ── 5. MCP servers ──────────────────────────────────────────────
  console.log(chalk.cyan("\n  MCP Servers (optional integrations):\n"));
  const mcpEnabled: string[] = [];

  for (const [cat, label] of Object.entries(MCP_CATEGORIES)) {
    const enable = await questionChoice(
      rl,
      `  ${label}:`,
      ["skip", "enable all"],
      0,
    );
    if (enable === "enable all") {
      mcpEnabled.push(cat);
    }
  }

  // ── 6. Build and write config ───────────────────────────────────

  const allEnvEntries = { ...envEntries, ...fallbackEnvEntries };
  if (Object.keys(allEnvEntries).length > 0) {
    writeSkeletonEnv(allEnvEntries);
    console.log(
      chalk.green(`\n  ✓ Secrets saved to ${getSkeletonEnvPath()}`),
    );
  }

  const apiKey = envEntries[profile.apiKeyEnvVars[0] ?? "API_KEY"] ?? "";

  const configObj: Record<string, any> = {
    baseUrl: profile.baseUrl,
    apiKey,
    model: modelInput,
    provider: profile.name,
  };

  if (fallbackProfile) {
    configObj.fallback = {
      provider: fallbackProfile.name,
      baseUrl: fallbackProfile.baseUrl,
      apiKey: fallbackEnvEntries[fallbackProfile.apiKeyEnvVars[0] ?? "API_KEY"] ?? "",
      model: fallbackModel,
    };
  }

  if (mcpEnabled.length > 0) {
    configObj.mcp = {};
    for (const cat of mcpEnabled) {
      configObj.mcp[cat] = { enabled: true };
    }
  }

  const jsonContent = JSON.stringify(configObj, null, 2);

  console.log(chalk.cyan("\n  Generated configuration:\n"));
  console.log(chalk.gray(jsonContent));

  const write = await questionChoice(
    rl,
    "  Write to ~/.skeleton/config.json?",
    ["yes", "no"],
    0,
  );
  if (write === "yes") {
    writeSimpleConfig(configObj as any);
    console.log(chalk.green(`\n  ✓ Configuration saved to ${CONFIG_FILE}`));
  } else {
    console.log(
      chalk.gray("\n  Skipped. You can create config.json manually."),
    );
  }

  // ── 7. Summary ──────────────────────────────────────────────────
  console.log(chalk.cyan("\n  Summary:"));
  console.log(
    chalk.white(
      `  Provider: ${profile.name}  Model: ${modelInput}  Base: ${profile.baseUrl}`,
    ),
  );
  if (fallbackProfile) {
    console.log(
      chalk.white(
        `  Fallback: ${fallbackProfile.name}  Model: ${fallbackModel}`,
      ),
    );
  }
  if (Object.keys(allEnvEntries).length > 0) {
    console.log(
      chalk.white(
        `  Secrets: ${Object.keys(allEnvEntries).join(", ")}`,
      ),
    );
  }
  console.log(
    chalk.gray("\n  Run `skeleton` to start, or `skeleton doctor` to verify."),
  );
  console.log();

  rl.close();
}
