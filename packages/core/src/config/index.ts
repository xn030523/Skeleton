import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { AgentConfig, LLMConfig, Protocol, ReasoningEffort, ToolDef } from "../types.js";
import { builtInTools } from "../tools/index.js";
import type { SkillConfig } from "../skills/index.js";
import { buildMcpServersConfig } from "../mcp/index.js";
import { MemoryStore } from "../memory/store.js";
import { UserProfile } from "../memory/user-profile.js";
import { memoryTools } from "../memory/tools.js";
import { CronStore } from "../cron/store.js";

export interface McpServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

export function loadConfig(configPath?: string): AgentConfig {
  const yamlConfig = loadYaml(configPath);

  const llm = resolveLLM(yamlConfig.llm);
  const fallback = yamlConfig.fallback ? resolveLLM(yamlConfig.fallback) : undefined;

  return {
    llm,
    fallback,
    maxTurns: yamlConfig.agent?.maxTurns ?? 20,
    systemPrompt: yamlConfig.agent?.systemPrompt ?? defaultPrompt(),
    skills: resolveSkillConfig(yamlConfig.skills),
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

  // Memory tools — LLM can save/search memories and user preferences
  tools.push(...memoryTools(mem, profile));

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
  };
  tools?: RawToolConfig;
  mcp?: RawMcpConfig;
  skills?: SkillConfig;
}

function loadYaml(configPath?: string): RawConfig {
  const searchPaths = [
    configPath,
    path.join(process.cwd(), "skeleton.yaml"),
    path.join(process.cwd(), "skeleton.yml"),
    path.join(process.env.HOME ?? "~", ".skeleton", "config.yaml"),
  ].filter(Boolean) as string[];

  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      return parseYaml(fs.readFileSync(p, "utf-8")) as RawConfig;
    }
  }
  return {};
}
