/**
 * Tool output budget configuration — per-tool limits loaded from YAML/JSON.
 * Merge priority: defaults < config file < environment variable overrides.
 */

export interface ToolBudget {
  maxOutputTokens: number;
  maxLines: number;
  persistThreshold: number;
}

export interface BudgetConfig {
  defaults: ToolBudget;
  tools: Record<string, Partial<ToolBudget>>;
}

const DEFAULT_BUDGET: ToolBudget = {
  maxOutputTokens: 4096,
  maxLines: 200,
  persistThreshold: 8192,
};

const ENV_PREFIX = "SKELETON_BUDGET_";

/** Load budget config from a YAML or JSON file */
export function loadBudgetConfig(filePath: string): BudgetConfig {
  const fs = require("node:fs") as typeof import("node:fs");
  let raw: Record<string, unknown>;

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    if (filePath.endsWith(".json")) {
      raw = JSON.parse(content);
    } else {
      // Minimal YAML parser: supports simple key/value and nested maps
      raw = parseSimpleYaml(content);
    }
  } catch {
    return { defaults: { ...DEFAULT_BUDGET }, tools: {} };
  }

  const defaults: ToolBudget = {
    maxOutputTokens: typeof raw.maxOutputTokens === "number" ? raw.maxOutputTokens : DEFAULT_BUDGET.maxOutputTokens,
    maxLines: typeof raw.maxLines === "number" ? raw.maxLines : DEFAULT_BUDGET.maxLines,
    persistThreshold: typeof raw.persistThreshold === "number" ? raw.persistThreshold : DEFAULT_BUDGET.persistThreshold,
  };

  const tools: Record<string, Partial<ToolBudget>> = {};
  const toolsRaw = raw.tools as Record<string, Record<string, number>> | undefined;
  if (toolsRaw && typeof toolsRaw === "object") {
    for (const [toolName, budget] of Object.entries(toolsRaw)) {
      tools[toolName] = {};
      if (typeof budget.maxOutputTokens === "number") tools[toolName].maxOutputTokens = budget.maxOutputTokens;
      if (typeof budget.maxLines === "number") tools[toolName].maxLines = budget.maxLines;
      if (typeof budget.persistThreshold === "number") tools[toolName].persistThreshold = budget.persistThreshold;
    }
  }

  // Environment variable overrides
  applyEnvOverrides(defaults, tools);

  return { defaults, tools };
}

/** Resolve the final budget for a specific tool */
export function resolveToolBudget(toolName: string, config: BudgetConfig): ToolBudget {
  const toolOverride = config.tools[toolName] ?? {};
  return {
    maxOutputTokens: toolOverride.maxOutputTokens ?? config.defaults.maxOutputTokens,
    maxLines: toolOverride.maxLines ?? config.defaults.maxLines,
    persistThreshold: toolOverride.persistThreshold ?? config.defaults.persistThreshold,
  };
}

function applyEnvOverrides(defaults: ToolBudget, tools: Record<string, Partial<ToolBudget>>): void {
  const envDefaultTokens = process.env[`${ENV_PREFIX}DEFAULT_MAX_TOKENS`];
  if (envDefaultTokens) {
    const val = parseInt(envDefaultTokens, 10);
    if (!isNaN(val)) defaults.maxOutputTokens = val;
  }
  const envDefaultLines = process.env[`${ENV_PREFIX}DEFAULT_MAX_LINES`];
  if (envDefaultLines) {
    const val = parseInt(envDefaultLines, 10);
    if (!isNaN(val)) defaults.maxLines = val;
  }
  const envDefaultPersist = process.env[`${ENV_PREFIX}DEFAULT_PERSIST_THRESHOLD`];
  if (envDefaultPersist) {
    const val = parseInt(envDefaultPersist, 10);
    if (!isNaN(val)) defaults.persistThreshold = val;
  }

  // Per-tool env overrides: SKELETON_BUDGET_<TOOLNAME>_MAX_TOKENS
  for (const key of Object.keys(process.env)) {
    if (!key.startsWith(ENV_PREFIX)) continue;
    const rest = key.slice(ENV_PREFIX.length);
    const parts = rest.split("_");
    if (parts.length < 2) continue;
    const suffix = parts[parts.length - 1];
    const toolEnvName = parts.slice(0, -1).join("_");
    if (!toolEnvName || toolEnvName === "DEFAULT") continue;

    const val = parseInt(process.env[key]!, 10);
    if (isNaN(val)) continue;

    if (!tools[toolEnvName]) tools[toolEnvName] = {};
    if (suffix === "TOKENS") tools[toolEnvName].maxOutputTokens = val;
    else if (suffix === "LINES") tools[toolEnvName].maxLines = val;
    else if (suffix === "THRESHOLD") tools[toolEnvName].persistThreshold = val;
  }
}

function parseSimpleYaml(content: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  let currentPath: string[] = [];
  let currentObj = result;

  for (const line of content.split("\n")) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;
    const match = trimmed.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!match) continue;

    const [, key, value] = match;

    // Determine nesting level
    const level = Math.floor(indent / 2);
    currentPath = currentPath.slice(0, level);
    currentObj = currentPath.reduce((obj, k) => obj[k] as Record<string, unknown>, result);

    if (value === "" || value === null) {
      currentObj[key] = {};
      currentPath.push(key);
    } else {
      const num = Number(value);
      currentObj[key] = isNaN(num) ? value : num;
    }
  }
  return result;
}
