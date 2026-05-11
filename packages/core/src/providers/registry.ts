/**
 * Provider Registry — model provider profile lookup and resolution.
 *
 * Maps provider names/aliases to their API configuration (baseUrl,
 * apiKey env vars, default model, api mode, transport quirks) so users
 * can write `provider: deepseek` instead of memorizing URLs and env var names.
 *
 * Inspired by Hermes ProviderProfile + adapter quirks system.
 */

import type { LLMConfig, Protocol } from "../types.js";

export type ApiMode = "chat_completions" | "anthropic_messages" | "codex_responses" | "bedrock_converse" | "gemini_native" | "gemini_cloudcode";

export type AuthMode = "x-api-key" | "bearer" | "api-key";

export interface ProviderQuirks {
  urlSuffix?: string;
  skipApiKey?: boolean;
  authMode?: AuthMode;
  customHeaders?: Record<string, string>;
  queryParams?: Record<string, string>;
  isThirdPartyAnthropic?: boolean;
  stripBetaHeaders?: string[];
  stripSignedThinking?: boolean;
  maxOutputTokens?: number;
  noCaching?: boolean;
  /** Extra body fields to merge into every request (e.g., OpenRouter caching) */
  extraBody?: Record<string, unknown>;
}

export interface ProviderProfile {
  name: string;
  aliases: string[];
  apiMode: ApiMode;
  baseUrl: string;
  apiKeyEnvVars: string[];
  defaultModel: string;
  quirks?: ProviderQuirks;
}

const PROVIDERS = new Map<string, ProviderProfile>();
const ALIAS_MAP = new Map<string, string>();

/** Register a provider profile (idempotent — overwrites if same name) */
export function registerProvider(profile: ProviderProfile): void {
  PROVIDERS.set(profile.name.toLowerCase(), profile);
  for (const alias of profile.aliases) {
    ALIAS_MAP.set(alias.toLowerCase(), profile.name.toLowerCase());
  }
}

/** Find a provider by name or alias (case-insensitive) */
export function findProvider(name: string): ProviderProfile | null {
  const lower = name.toLowerCase();
  return PROVIDERS.get(lower) ?? PROVIDERS.get(ALIAS_MAP.get(lower) ?? "") ?? null;
}

/** List all registered provider profiles */
export function listProviders(): ProviderProfile[] {
  return [...PROVIDERS.values()];
}

/** Resolve a ProviderProfile into a complete LLMConfig */
export function resolveProviderConfig(
  profile: ProviderProfile,
  overrides?: Partial<LLMConfig>,
): LLMConfig {
  const protocol = apiModeToProtocol(profile.apiMode);

  let apiKey = overrides?.apiKey ?? "";
  if (!apiKey && !profile.quirks?.skipApiKey) {
    for (const envVar of profile.apiKeyEnvVars) {
      if (process.env[envVar]) {
        apiKey = process.env[envVar]!;
        break;
      }
    }
  }

  let baseUrl = overrides?.baseUrl ?? "";
  if (!baseUrl) {
    baseUrl = profile.baseUrl;
    const suffix = profile.quirks?.urlSuffix;
    if (suffix && !baseUrl.endsWith(suffix)) {
      baseUrl += suffix;
    }
  }

  // Append query parameters
  if (profile.quirks?.queryParams && !overrides?.baseUrl) {
    const params = new URLSearchParams(profile.quirks.queryParams);
    const sep = baseUrl.includes("?") ? "&" : "?";
    baseUrl += sep + params.toString();
  }

  const model = overrides?.model ?? profile.defaultModel;

  return {
    protocol,
    apiKey,
    baseUrl,
    model,
    provider: profile.name,
    maxTokens: overrides?.maxTokens ?? profile.quirks?.maxOutputTokens ?? 4096,
    temperature: overrides?.temperature ?? 0.3,
    reasoningEffort: overrides?.reasoningEffort,
  };
}

/** Map ApiMode to Protocol for transport selection */
export function apiModeToProtocol(apiMode: ApiMode): Protocol {
  switch (apiMode) {
    case "anthropic_messages":
      return "anthropic";
    case "chat_completions":
    case "codex_responses":
      return "openai";
    case "bedrock_converse":
      return "openai";
    case "gemini_native":
      return "openai"; // Gemini uses its own transport, protocol field is nominal
    case "gemini_cloudcode":
      return "openai"; // Vertex AI uses its own transport
  }
}
