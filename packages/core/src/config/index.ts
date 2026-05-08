import fs from "node:fs";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import type { AgentConfig, LLMConfig, Protocol } from "../types.js";

export function loadConfig(configPath?: string): AgentConfig {
  const yamlConfig = loadYaml(configPath);

  const llm = resolveLLM(yamlConfig.llm);
  const fallback = yamlConfig.fallback ? resolveLLM(yamlConfig.fallback) : undefined;

  return {
    llm,
    fallback,
    maxTurns: yamlConfig.agent?.maxTurns ?? 20,
    systemPrompt: yamlConfig.agent?.systemPrompt ?? defaultPrompt(),
  };
}

function resolveLLM(partial: Partial<LLMConfig> = {}): LLMConfig {
  const protocol: Protocol = partial.protocol ?? (env("SKELETON_PROTOCOL") as Protocol) ?? "openai";
  const apiKey = partial.apiKey ?? env("SKELETON_API_KEY") ?? "";
  const baseUrl = partial.baseUrl ?? env("SKELETON_BASE_URL") ?? defaultBaseUrl(protocol);
  const model = partial.model ?? env("SKELETON_MODEL") ?? defaultModel(protocol);

  return {
    protocol,
    apiKey,
    baseUrl,
    model,
    maxTokens: partial.maxTokens ?? 4096,
    temperature: partial.temperature ?? 0.3,
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

function env(key: string): string | undefined {
  return process.env[key] || undefined;
}

interface RawConfig {
  llm?: Partial<LLMConfig>;
  fallback?: Partial<LLMConfig>;
  agent?: {
    maxTurns?: number;
    systemPrompt?: string;
  };
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
