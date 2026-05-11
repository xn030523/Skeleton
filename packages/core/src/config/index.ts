import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { parse as parseYaml } from "yaml";
import type { AgentConfig, LLMConfig, Protocol, ReasoningEffort, ToolDef } from "../types.js";
import { builtInTools } from "../tools/index.js";
import type { SkillConfig } from "../skills/index.js";
import { buildMcpServersConfig } from "../mcp/index.js";
import { MemoryStore } from "../memory/store.js";
import { UserProfile } from "../memory/user-profile.js";
import { CronStore } from "../cron/store.js";
import { findProvider, resolveProviderConfig } from "../providers/registry.js";
import "../providers/profiles.js";

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  /** Transport type for url-based servers: "streamable-http" (default) or "sse" */
  transport?: "streamable-http" | "sse";
}

export function loadConfig(configPath?: string): AgentConfig {
  const yamlConfig = loadYaml(configPath);

  // Config structure validation — catch malformed YAML at startup
  const validationErrors = validateConfigStructure(yamlConfig);
  if (validationErrors.length > 0) {
    console.warn(`⚠️  Config validation warnings:`);
    for (const err of validationErrors) console.warn(`   - ${err}`);
  }

  const llm = resolveLLM(yamlConfig.llm);
  const fallback = yamlConfig.fallback ? resolveLLM(yamlConfig.fallback) : undefined;

  return {
    llm,
    fallback,
    maxTurns: yamlConfig.agent?.maxTurns ?? 20,
    systemPrompt: yamlConfig.agent?.systemPrompt ?? defaultPrompt(),
    skills: resolveSkillConfig(yamlConfig.skills),
    compression: yamlConfig.compression,
    behavior: yamlConfig.behavior ?? yamlConfig.agent?.behavior,
    toolOutput: yamlConfig.toolOutput,
    fileRead: yamlConfig.fileRead,
    auxiliary: yamlConfig.auxiliary,
    _rawToolConfig: yamlConfig.tools,
    _rawMcpConfig: yamlConfig.mcp,
  } as AgentConfig & { _rawToolConfig?: RawToolConfig; _rawMcpConfig?: RawMcpConfig; skills?: SkillConfig };
}

export async function loadTools(
  config: AgentConfig & { _rawToolConfig?: RawToolConfig; _rawMcpConfig?: RawMcpConfig },
  memory?: MemoryStore,
  userProfile?: UserProfile,
  cronStore?: CronStore,
): Promise<{ tools: ToolDef[]; mcpClients: unknown[]; mcpServerToolMap: Record<string, { toolNames: string[]; client: unknown }>; memory: MemoryStore; userProfile: UserProfile; cronStore: CronStore }> {
  const tools: ToolDef[] = [];
  const mcpClients: unknown[] = [];
  const mcpServerToolMap: Record<string, { toolNames: string[]; client: unknown }> = {};

  // Ensure memory store and user profile exist
  const mem = memory ?? new MemoryStore();
  const profile = userProfile ?? new UserProfile();
  const cron = cronStore ?? new CronStore();

  // Built-in RE tools
  const toolConfig = config._rawToolConfig;
  if (!toolConfig || toolConfig.builtin !== false) {
    const allBuiltIn = builtInTools();
    if (toolConfig?.builtinList) {
      const wanted = new Set(toolConfig.builtinList);
      tools.push(...allBuiltIn.filter((t) => wanted.has(t.name)));
    } else {
      tools.push(...allBuiltIn);
    }
  }

  // Merge built-in MCP servers with user config
  const servers = buildMcpServersConfig(config._rawMcpConfig?.servers);

  // Connect MCP servers
  if (Object.keys(servers).length > 0) {
    try {
      const { connectAllMcpServers } = await import("../tools/mcp.js");
      const result = await connectAllMcpServers(servers);
      // Apply mcp_{server}_ prefix to tool names (Hermes collision-prevention pattern)
      for (const [srvName, srvEntry] of Object.entries(result.serverToolMap)) {
        const prefixedNames: string[] = [];
        for (const origName of srvEntry.toolNames) {
          const prefixed = `mcp_${srvName}_${origName}`;
          const tool = result.tools.find(t => t.name === origName);
          if (tool) {
            (tool as { name: string }).name = prefixed;
            if (!tool.description.includes(srvName)) {
              (tool as { description: string }).description = `[${srvName}] ${tool.description}`;
            }
          }
          prefixedNames.push(prefixed);
        }
        srvEntry.toolNames = prefixedNames;
      }
      tools.push(...result.tools);
      mcpClients.push(...result.clients);
      Object.assign(mcpServerToolMap, result.serverToolMap);
    } catch (err) {
      console.error(`MCP connection failed: ${(err as Error).message}`);
    }
  }

  return { tools, mcpClients, mcpServerToolMap, memory: mem, userProfile: profile, cronStore: cron };
}

function resolveLLM(partial: Partial<LLMConfig> = {}): LLMConfig {
  // 1. Provider-based resolution: if provider name specified, resolve from profile
  const providerName = partial.provider ?? env("SKELETON_PROVIDER");
  if (providerName) {
    const profile = findProvider(providerName);
    if (profile) {
      return resolveProviderConfig(profile, partial);
    }
    console.warn(`Unknown provider "${providerName}", falling back to manual config`);
  }

  // 2. Legacy resolution: SKELETON_PROTOCOL + SKELETON_API_KEY + SKELETON_BASE_URL
  const protocol: Protocol = partial.protocol ?? (env("SKELETON_PROTOCOL") as Protocol) ?? "openai";
  const apiKey = partial.apiKey ?? env("SKELETON_API_KEY") ?? "";
  const baseUrl = partial.baseUrl ?? env("SKELETON_BASE_URL") ?? defaultBaseUrl(protocol);
  const model = partial.model ?? env("SKELETON_MODEL") ?? defaultModel(protocol);

  const reasoningEffort = partial.reasoningEffort ?? (env("SKELETON_REASONING_EFFORT") as ReasoningEffort | undefined) ?? undefined;

  return {
    protocol,
    apiKey,
    baseUrl,
    model,
    maxTokens: partial.maxTokens ?? 4096,
    temperature: partial.temperature ?? 0.3,
    reasoningEffort,
  };
}

function defaultBaseUrl(protocol: Protocol): string {
  if (protocol === "anthropic") return "https://api.anthropic.com";
  return "https://api.openai.com";
}

function defaultModel(protocol: Protocol): string {
  if (protocol === "anthropic") return "claude-sonnet-4-20250514";
  return "gpt-4o";
}

function defaultPrompt(): string {
  return `You are Skeleton, a reverse engineering AI assistant.
You help analyze binaries, deobfuscate code, trace execution flows,
identify vulnerabilities, and explain reverse engineering concepts.
Be precise, technical, and thorough.`;
}

function resolveSkillConfig(raw?: SkillConfig): SkillConfig {
  const ctfEnv = env("SKELETON_CTF_SKILLS");
  if (ctfEnv !== undefined) {
    return { ctf: ctfEnv.toLowerCase() === "false" ? false : ctfEnv.toLowerCase() === "auto" ? "auto" : true };
  }
  return raw ?? { ctf: true };
}

function env(key: string): string | undefined {
  return process.env[key] || undefined;
}

interface RawToolConfig {
  builtin?: boolean;
  builtinList?: string[];
}

interface RawMcpConfig {
  servers?: Record<string, McpServerConfig>;
}

interface RawConfig {
  llm?: Partial<LLMConfig>;
  fallback?: Partial<LLMConfig>;
  agent?: {
    maxTurns?: number;
    systemPrompt?: string;
    behavior?: AgentConfig["behavior"];
  };
  tools?: RawToolConfig;
  mcp?: RawMcpConfig;
  skills?: SkillConfig;
  compression?: AgentConfig["compression"];
  behavior?: AgentConfig["behavior"];
  toolOutput?: AgentConfig["toolOutput"];
  fileRead?: AgentConfig["fileRead"];
  auxiliary?: AgentConfig["auxiliary"];
}

function loadYaml(configPath?: string): RawConfig {
  const searchPaths = [
    configPath,
    path.join(process.cwd(), "skeleton.yaml"),
    path.join(process.cwd(), "skeleton.yml"),
    path.join(os.homedir(), ".skeleton", "config.yaml"),
  ].filter(Boolean) as string[];

  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, "utf-8");
      // Substitute ${VAR} references with env var values (Hermes-style)
      const substituted = substituteEnvVars(raw);
      return parseYaml(substituted) as RawConfig;
    }
  }
  return {};
}

/**
 * Replace ${VAR_NAME} patterns in YAML text with environment variable values.
 * Also supports ${VAR_NAME:-default} syntax for default values.
 *
 * This matches Hermes's config.yaml ${VAR} substitution pattern.
 */
function substituteEnvVars(text: string): string {
  // Match ${VAR} or ${VAR:-default}
  return text.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g, (_match, varName, defaultVal) => {
    const envVal = process.env[varName];
    if (envVal !== undefined && envVal !== "") return envVal;
    if (defaultVal !== undefined) return defaultVal;
    return ""; // Unset var with no default → empty string
  });
}

const VALID_TOP_KEYS = new Set(["llm", "fallback", "agent", "tools", "mcp", "skills", "compression", "behavior", "toolOutput", "fileRead", "auxiliary", "credentials"]);
const VALID_LLM_KEYS = new Set(["protocol", "apiKey", "baseUrl", "model", "provider", "maxTokens", "temperature", "reasoningEffort", "apiKeys", "credentialStrategy"]);
const VALID_PROTOCOLS = new Set(["openai", "anthropic"]);

function validateConfigStructure(config: RawConfig): string[] {
  const errors: string[] = [];

  for (const key of Object.keys(config)) {
    if (!VALID_TOP_KEYS.has(key)) {
      errors.push(`Unknown top-level key "${key}" — did you mean one of: ${[...VALID_TOP_KEYS].join(", ")}?`);
    }
  }

  if (config.llm) {
    for (const key of Object.keys(config.llm)) {
      if (!VALID_LLM_KEYS.has(key)) {
        errors.push(`Unknown key "llm.${key}" — valid keys: ${[...VALID_LLM_KEYS].join(", ")}`);
      }
    }
    if (config.llm.protocol && !VALID_PROTOCOLS.has(config.llm.protocol)) {
      errors.push(`Invalid llm.protocol "${config.llm.protocol}" — must be "openai" or "anthropic"`);
    }
    if (config.llm.maxTokens && (typeof config.llm.maxTokens !== "number" || config.llm.maxTokens < 1)) {
      errors.push(`llm.maxTokens must be a positive number, got: ${config.llm.maxTokens}`);
    }
    if (config.llm.temperature !== undefined && (typeof config.llm.temperature !== "number" || config.llm.temperature < 0 || config.llm.temperature > 2)) {
      errors.push(`llm.temperature must be 0-2, got: ${config.llm.temperature}`);
    }
  }

  if (config.agent) {
    if (config.agent.maxTurns !== undefined && (typeof config.agent.maxTurns !== "number" || config.agent.maxTurns < 1)) {
      errors.push(`agent.maxTurns must be a positive number, got: ${config.agent.maxTurns}`);
    }
  }

  if (config.compression) {
    const c = config.compression as Record<string, unknown>;
    if (c.threshold !== undefined && (typeof c.threshold !== "number" || c.threshold < 0 || c.threshold > 1)) {
      errors.push(`compression.threshold must be 0.0-1.0, got: ${c.threshold}`);
    }
    if (c.targetRatio !== undefined && (typeof c.targetRatio !== "number" || c.targetRatio < 0 || c.targetRatio > 1)) {
      errors.push(`compression.targetRatio must be 0.0-1.0, got: ${c.targetRatio}`);
    }
  }

  return errors;
}
