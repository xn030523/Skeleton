import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { AgentConfig, LLMConfig, Protocol, ReasoningEffort, ToolDef } from "../types.js";
import { builtInTools } from "../tools/index.js";
import type { SkillConfig } from "../skills/index.js";
import { buildMcpServersConfig } from "../mcp/index.js";
import { MemoryStore } from "../memory/store.js";
import { UserProfile } from "../memory/user-profile.js";
import { CronStore } from "../cron/store.js";
import { findProvider, resolveProviderConfig } from "../providers/registry.js";
import "../providers/profiles.js";
import { readSimpleConfig, simpleConfigToLLM, getConfigValue } from "./simple.js";

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
  // Simple JSON config (~/.skeleton/config.json) — the only config most users need
  const simple = readSimpleConfig();
  if (simple) {
    const llm = simpleConfigToLLM(simple);
    // Read user-defined MCP servers from config.json
    const userMcp = (simple as any).mcp as Record<string, McpServerConfig> | undefined;
    return {
      llm: llm as any,
      fallback: undefined,
      maxTurns: 20,
      systemPrompt: defaultPrompt(),
      tools: [],
      skills: { ctf: true },
      compression: undefined,
      behavior: undefined,
      toolOutput: undefined,
      fileRead: undefined,
      auxiliary: undefined,
      _rawMcpConfig: userMcp ? { servers: userMcp } : undefined,
    } as any;
  }

  // Fallback: no config.json found, try to resolve from env/defaults
  const llm = resolveLLM({});

  return {
    llm,
    fallback: undefined,
    maxTurns: 20,
    systemPrompt: defaultPrompt(),
    skills: resolveSkillConfig(undefined),
    compression: undefined,
    behavior: undefined,
    toolOutput: undefined,
    fileRead: undefined,
    auxiliary: undefined,
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
  const providerName = partial.provider ?? (getConfigValue("SKELETON_PROVIDER") || undefined);
  if (providerName) {
    const profile = findProvider(providerName);
    if (profile) {
      return resolveProviderConfig(profile, partial);
    }
    console.warn(`Unknown provider "${providerName}", falling back to manual config`);
  }

  // 2. Legacy resolution
  const protocol: Protocol = partial.protocol ?? (getConfigValue("SKELETON_PROTOCOL") as Protocol || "openai");
  const apiKey = partial.apiKey ?? (getConfigValue("SKELETON_API_KEY") || "");
  const baseUrl = partial.baseUrl ?? (getConfigValue("SKELETON_BASE_URL") || defaultBaseUrl(protocol));
  const model = partial.model ?? (getConfigValue("SKELETON_MODEL") || defaultModel(protocol));

  const reasoningEffort = partial.reasoningEffort ?? (getConfigValue("SKELETON_REASONING_EFFORT") as ReasoningEffort || undefined);

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
