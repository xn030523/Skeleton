export interface ModelMetadata {
  name: string;
  provider: string;
  contextWindow: number;
  maxOutput: number;
  vision: boolean;
  tools: boolean;
  pricing: {
    inputPer1M: number;
    outputPer1M: number;
  };
  aliases: string[];
}

// ── Default fallback (Hermes: 256K) ──────────────────────────────────────────
const DEFAULT_FALLBACK_CONTEXT = 256_000;

// ── Fuzzy substring fallback table (Hermes-style: longest key first) ─────────
const DEFAULT_CONTEXT_LENGTHS: Record<string, number> = {
  "claude-opus-4-7": 1_000_000,
  "claude-opus-4.7": 1_000_000,
  "claude-opus-4-6": 1_000_000,
  "claude-sonnet-4-6": 1_000_000,
  "claude-sonnet-4.6": 1_000_000,
  "claude-opus-4": 200_000,
  "claude-sonnet-4": 200_000,
  "claude": 200_000,
  "gpt-5.5": 1_050_000,
  "gpt-5.4-nano": 400_000,
  "gpt-5.4-mini": 400_000,
  "gpt-5.4": 1_050_000,
  "gpt-5": 400_000,
  "gpt-4.1": 1_047_576,
  "gpt-4": 128_000,
  "gemini": 1_048_576,
  "gemma-4": 256_000,
  "gemma-3": 131_072,
  "deepseek-v4-pro": 1_000_000,
  "deepseek-v4-flash": 1_000_000,
  "deepseek-chat": 1_000_000,
  "deepseek-reasoner": 1_000_000,
  "deepseek": 128_000,
  "llama": 131_072,
  "qwen3-coder-plus": 1_000_000,
  "qwen3-coder": 262_144,
  "qwen": 131_072,
  "minimax": 204_800,
  "glm": 202_752,
  "grok-4.20": 2_000_000,
  "grok-4-fast": 2_000_000,
  "grok-4-1-fast": 2_000_000,
  "grok-4": 256_000,
  "grok-3": 131_072,
  "grok-2": 131_072,
  "kimi": 262_144,
  "moonshot": 262_144,
  "nemotron": 131_072,
  "step": 131_072,
};

// Sorted by key length descending for fuzzy matching (most specific first)
const FUZZY_KEYS = Object.entries(DEFAULT_CONTEXT_LENGTHS)
  .sort((a, b) => b[0].length - a[0].length);

// ── Full model metadata table ───────────────────────────────────────────────

const MODELS: ModelMetadata[] = [
  // ── Anthropic Claude (newest first) ──────────────────────────────────────
  { name: "claude-opus-4-7", provider: "anthropic", contextWindow: 1_000_000, maxOutput: 32000, vision: true, tools: true, pricing: { inputPer1M: 15, outputPer1M: 75 }, aliases: ["claude-opus-4.7", "opus-4-7"] },
  { name: "claude-opus-4-6", provider: "anthropic", contextWindow: 1_000_000, maxOutput: 32000, vision: true, tools: true, pricing: { inputPer1M: 15, outputPer1M: 75 }, aliases: ["claude-opus-4.6", "opus-4-6"] },
  { name: "claude-sonnet-4-6", provider: "anthropic", contextWindow: 1_000_000, maxOutput: 64000, vision: true, tools: true, pricing: { inputPer1M: 3, outputPer1M: 15 }, aliases: ["claude-sonnet-4.6", "sonnet-4-6"] },
  { name: "claude-sonnet-4-20250514", provider: "anthropic", contextWindow: 200_000, maxOutput: 64000, vision: true, tools: true, pricing: { inputPer1M: 3, outputPer1M: 15 }, aliases: ["sonnet", "claude-sonnet", "sonnet-4"] },
  { name: "claude-opus-4-20250514", provider: "anthropic", contextWindow: 200_000, maxOutput: 32000, vision: true, tools: true, pricing: { inputPer1M: 15, outputPer1M: 75 }, aliases: ["opus", "claude-opus", "opus-4"] },
  { name: "claude-3-5-sonnet-20241022", provider: "anthropic", contextWindow: 200_000, maxOutput: 8192, vision: true, tools: true, pricing: { inputPer1M: 3, outputPer1M: 15 }, aliases: ["claude-3.5-sonnet", "sonnet-3.5"] },
  { name: "claude-3-5-haiku-20241022", provider: "anthropic", contextWindow: 200_000, maxOutput: 8192, vision: true, tools: true, pricing: { inputPer1M: 0.8, outputPer1M: 4 }, aliases: ["haiku", "claude-haiku", "haiku-3.5"] },
  { name: "claude-3-opus-20240229", provider: "anthropic", contextWindow: 200_000, maxOutput: 4096, vision: true, tools: true, pricing: { inputPer1M: 15, outputPer1M: 75 }, aliases: ["opus-3", "claude-3-opus"] },
  { name: "claude-3-haiku-20240307", provider: "anthropic", contextWindow: 200_000, maxOutput: 4096, vision: true, tools: true, pricing: { inputPer1M: 0.25, outputPer1M: 1.25 }, aliases: ["haiku-3"] },
  // ── OpenAI ────────────────────────────────────────────────────────────────
  { name: "gpt-5.5", provider: "openai", contextWindow: 1_050_000, maxOutput: 32768, vision: true, tools: true, pricing: { inputPer1M: 10, outputPer1M: 40 }, aliases: [] },
  { name: "gpt-5.4", provider: "openai", contextWindow: 1_050_000, maxOutput: 32768, vision: true, tools: true, pricing: { inputPer1M: 10, outputPer1M: 40 }, aliases: [] },
  { name: "gpt-5.4-nano", provider: "openai", contextWindow: 400_000, maxOutput: 32768, vision: true, tools: true, pricing: { inputPer1M: 0.4, outputPer1M: 1.6 }, aliases: [] },
  { name: "gpt-5.4-mini", provider: "openai", contextWindow: 400_000, maxOutput: 32768, vision: true, tools: true, pricing: { inputPer1M: 1.5, outputPer1M: 6 }, aliases: [] },
  { name: "gpt-5", provider: "openai", contextWindow: 400_000, maxOutput: 32768, vision: true, tools: true, pricing: { inputPer1M: 10, outputPer1M: 40 }, aliases: [] },
  { name: "gpt-4.1", provider: "openai", contextWindow: 1_047_576, maxOutput: 32768, vision: true, tools: true, pricing: { inputPer1M: 2, outputPer1M: 8 }, aliases: ["gpt4.1"] },
  { name: "gpt-4.1-mini", provider: "openai", contextWindow: 1_047_576, maxOutput: 32768, vision: true, tools: true, pricing: { inputPer1M: 0.4, outputPer1M: 1.6 }, aliases: ["gpt4.1-mini"] },
  { name: "gpt-4.1-nano", provider: "openai", contextWindow: 1_047_576, maxOutput: 32768, vision: true, tools: true, pricing: { inputPer1M: 0.1, outputPer1M: 0.4 }, aliases: ["gpt4.1-nano"] },
  { name: "gpt-4o", provider: "openai", contextWindow: 128_000, maxOutput: 16384, vision: true, tools: true, pricing: { inputPer1M: 2.5, outputPer1M: 10 }, aliases: ["gpt4o", "gpt-4o-2024-08-06"] },
  { name: "gpt-4o-mini", provider: "openai", contextWindow: 128_000, maxOutput: 16384, vision: true, tools: true, pricing: { inputPer1M: 0.15, outputPer1M: 0.6 }, aliases: ["gpt4o-mini", "gpt-4o-mini-2024-07-18"] },
  { name: "o3", provider: "openai", contextWindow: 200_000, maxOutput: 100000, vision: true, tools: true, pricing: { inputPer1M: 10, outputPer1M: 40 }, aliases: [] },
  { name: "o3-mini", provider: "openai", contextWindow: 200_000, maxOutput: 100000, vision: false, tools: true, pricing: { inputPer1M: 1.1, outputPer1M: 4.4 }, aliases: ["o3-mini-2025-01-31"] },
  { name: "o4-mini", provider: "openai", contextWindow: 200_000, maxOutput: 100000, vision: true, tools: true, pricing: { inputPer1M: 1.1, outputPer1M: 4.4 }, aliases: ["o4-mini-2025-04-16"] },
  { name: "o1", provider: "openai", contextWindow: 200_000, maxOutput: 100000, vision: true, tools: false, pricing: { inputPer1M: 15, outputPer1M: 60 }, aliases: ["o1-2024-12-17"] },
  // ── Google Gemini ───────────────────────────────────────────────────────
  { name: "gemini-2.5-pro", provider: "google", contextWindow: 1_048_576, maxOutput: 65536, vision: true, tools: true, pricing: { inputPer1M: 1.25, outputPer1M: 10 }, aliases: ["gemini-pro", "gemini-2.5-pro-preview"] },
  { name: "gemini-2.5-flash", provider: "google", contextWindow: 1_048_576, maxOutput: 65536, vision: true, tools: true, pricing: { inputPer1M: 0.15, outputPer1M: 0.6 }, aliases: ["gemini-flash"] },
  { name: "gemini-2.0-flash", provider: "google", contextWindow: 1_048_576, maxOutput: 8192, vision: true, tools: true, pricing: { inputPer1M: 0.1, outputPer1M: 0.4 }, aliases: [] },
  { name: "gemini-1.5-pro", provider: "google", contextWindow: 2_097_152, maxOutput: 8192, vision: true, tools: true, pricing: { inputPer1M: 1.25, outputPer1M: 5 }, aliases: [] },
  { name: "gemini-1.5-flash", provider: "google", contextWindow: 1_048_576, maxOutput: 8192, vision: true, tools: true, pricing: { inputPer1M: 0.075, outputPer1M: 0.3 }, aliases: [] },
  // ── DeepSeek ─────────────────────────────────────────────────────────────
  { name: "deepseek-v4-pro", provider: "deepseek", contextWindow: 1_000_000, maxOutput: 8192, vision: false, tools: true, pricing: { inputPer1M: 0.27, outputPer1M: 1.1 }, aliases: ["deepseek-v4", "deepseek-chat-v4"] },
  { name: "deepseek-v4-flash", provider: "deepseek", contextWindow: 1_000_000, maxOutput: 8192, vision: false, tools: true, pricing: { inputPer1M: 0.15, outputPer1M: 0.6 }, aliases: [] },
  { name: "deepseek-chat", provider: "deepseek", contextWindow: 1_000_000, maxOutput: 8192, vision: false, tools: true, pricing: { inputPer1M: 0.27, outputPer1M: 1.1 }, aliases: ["deepseek-v3"] },
  { name: "deepseek-reasoner", provider: "deepseek", contextWindow: 1_000_000, maxOutput: 8192, vision: false, tools: true, pricing: { inputPer1M: 0.55, outputPer1M: 2.19 }, aliases: ["deepseek-r1"] },
  // ── xAI Grok ─────────────────────────────────────────────────────────────
  { name: "grok-4.20", provider: "xai", contextWindow: 2_000_000, maxOutput: 16384, vision: true, tools: true, pricing: { inputPer1M: 3, outputPer1M: 15 }, aliases: [] },
  { name: "grok-4-fast", provider: "xai", contextWindow: 2_000_000, maxOutput: 16384, vision: true, tools: true, pricing: { inputPer1M: 3, outputPer1M: 15 }, aliases: [] },
  { name: "grok-4", provider: "xai", contextWindow: 256_000, maxOutput: 8192, vision: false, tools: true, pricing: { inputPer1M: 3, outputPer1M: 15 }, aliases: [] },
  { name: "grok-3", provider: "xai", contextWindow: 131_072, maxOutput: 8192, vision: false, tools: true, pricing: { inputPer1M: 3, outputPer1M: 15 }, aliases: [] },
  { name: "grok-3-mini", provider: "xai", contextWindow: 131_072, maxOutput: 8192, vision: false, tools: true, pricing: { inputPer1M: 0.15, outputPer1M: 0.75 }, aliases: [] },
  { name: "grok-2", provider: "xai", contextWindow: 131_072, maxOutput: 4096, vision: false, tools: true, pricing: { inputPer1M: 2, outputPer1M: 10 }, aliases: [] },
  // ── Meta Llama ───────────────────────────────────────────────────────────
  { name: "llama-3.1-405b-instruct", provider: "meta", contextWindow: 131_072, maxOutput: 4096, vision: false, tools: true, pricing: { inputPer1M: 3, outputPer1M: 3 }, aliases: ["llama-3.1-405b"] },
  { name: "llama-3.1-70b-instruct", provider: "meta", contextWindow: 131_072, maxOutput: 4096, vision: false, tools: true, pricing: { inputPer1M: 0.54, outputPer1M: 0.54 }, aliases: ["llama-3.1-70b"] },
  { name: "llama-3.1-8b-instruct", provider: "meta", contextWindow: 131_072, maxOutput: 4096, vision: false, tools: true, pricing: { inputPer1M: 0.05, outputPer1M: 0.05 }, aliases: ["llama-3.1-8b"] },
  // ── Alibaba Qwen ────────────────────────────────────────────────────────
  { name: "qwen3-coder-plus", provider: "alibaba", contextWindow: 1_000_000, maxOutput: 8192, vision: false, tools: true, pricing: { inputPer1M: 0.4, outputPer1M: 1.2 }, aliases: [] },
  { name: "qwen3-coder", provider: "alibaba", contextWindow: 262_144, maxOutput: 8192, vision: false, tools: true, pricing: { inputPer1M: 0.3, outputPer1M: 0.9 }, aliases: [] },
  { name: "qwen-plus", provider: "alibaba", contextWindow: 131_072, maxOutput: 8192, vision: false, tools: true, pricing: { inputPer1M: 0.4, outputPer1M: 1.2 }, aliases: ["qwen-plus-latest"] },
  { name: "qwen-max", provider: "alibaba", contextWindow: 32768, maxOutput: 8192, vision: false, tools: true, pricing: { inputPer1M: 1.6, outputPer1M: 6.4 }, aliases: ["qwen-max-latest"] },
  { name: "qwen-turbo", provider: "alibaba", contextWindow: 131_072, maxOutput: 8192, vision: false, tools: true, pricing: { inputPer1M: 0.05, outputPer1M: 0.2 }, aliases: ["qwen-turbo-latest"] },
  // ── MiniMax ──────────────────────────────────────────────────────────────
  { name: "minimax-01", provider: "minimax", contextWindow: 204_800, maxOutput: 4096, vision: false, tools: false, pricing: { inputPer1M: 0.2, outputPer1M: 1.1 }, aliases: ["minimax-text-01", "minimax-m2.5"] },
  // ── Moonshot / Kimi ──────────────────────────────────────────────────────
  { name: "moonshot-v1-128k", provider: "moonshot", contextWindow: 262_144, maxOutput: 8192, vision: false, tools: false, pricing: { inputPer1M: 1.3, outputPer1M: 1.3 }, aliases: ["kimi", "moonshot-v1", "kimi-k2.5", "kimi-k2.6"] },
  // ── Zhipu GLM ─────────────────────────────────────────────────────────────
  { name: "glm-4", provider: "zhipu", contextWindow: 202_752, maxOutput: 4096, vision: true, tools: true, pricing: { inputPer1M: 1.5, outputPer1M: 1.5 }, aliases: ["chatglm-4", "glm-5", "glm-5p1"] },
  { name: "glm-4-flash", provider: "zhipu", contextWindow: 202_752, maxOutput: 4096, vision: true, tools: true, pricing: { inputPer1M: 0.1, outputPer1M: 0.1 }, aliases: ["chatglm-4-flash"] },
  // ── StepFun ───────────────────────────────────────────────────────────────
  { name: "step-2", provider: "stepfun", contextWindow: 131_072, maxOutput: 8192, vision: true, tools: true, pricing: { inputPer1M: 2.5, outputPer1M: 2.5 }, aliases: [] },
  // ── Mistral ───────────────────────────────────────────────────────────────
  { name: "mistral-large", provider: "mistral", contextWindow: 128_000, maxOutput: 4096, vision: false, tools: true, pricing: { inputPer1M: 2, outputPer1M: 6 }, aliases: ["mistral-large-latest"] },
  { name: "mistral-small", provider: "mistral", contextWindow: 32000, maxOutput: 4096, vision: false, tools: true, pricing: { inputPer1M: 0.1, outputPer1M: 0.3 }, aliases: ["mistral-small-latest"] },
  { name: "codestral", provider: "mistral", contextWindow: 32000, maxOutput: 4096, vision: false, tools: false, pricing: { inputPer1M: 0.3, outputPer1M: 0.9 }, aliases: ["codestral-latest"] },
  // ── Amazon ────────────────────────────────────────────────────────────────
  { name: "amazon-nova-pro", provider: "amazon", contextWindow: 300_000, maxOutput: 5000, vision: true, tools: true, pricing: { inputPer1M: 0.8, outputPer1M: 3.2 }, aliases: ["nova-pro"] },
  { name: "amazon-nova-lite", provider: "amazon", contextWindow: 300_000, maxOutput: 5000, vision: true, tools: true, pricing: { inputPer1M: 0.06, outputPer1M: 0.24 }, aliases: ["nova-lite"] },
  { name: "amazon-nova-micro", provider: "amazon", contextWindow: 128_000, maxOutput: 5000, vision: false, tools: true, pricing: { inputPer1M: 0.035, outputPer1M: 0.14 }, aliases: ["nova-micro"] },
  // ── Inference providers ───────────────────────────────────────────────────
  { name: "fireworks/llama-3.1-70b-instruct", provider: "fireworks", contextWindow: 131_072, maxOutput: 4096, vision: false, tools: true, pricing: { inputPer1M: 0.36, outputPer1M: 0.36 }, aliases: [] },
  { name: "together/llama-3.1-70b-instruct", provider: "together", contextWindow: 131_072, maxOutput: 4096, vision: true, tools: true, pricing: { inputPer1M: 0.54, outputPer1M: 0.54 }, aliases: [] },
  { name: "groq/llama-3.1-70b-instruct", provider: "groq", contextWindow: 131_072, maxOutput: 4096, vision: false, tools: true, pricing: { inputPer1M: 0.54, outputPer1M: 0.54 }, aliases: [] },
  { name: "cerebras/llama-3.1-70b-instruct", provider: "cerebras", contextWindow: 131_072, maxOutput: 4096, vision: false, tools: true, pricing: { inputPer1M: 0.54, outputPer1M: 0.54 }, aliases: [] },
  { name: "sambanova/llama-3.1-70b-instruct", provider: "sambanova", contextWindow: 131_072, maxOutput: 4096, vision: false, tools: false, pricing: { inputPer1M: 0.54, outputPer1M: 0.54 }, aliases: [] },
  { name: "nvidia/llama-3.1-nemotron-70b-instruct", provider: "nvidia", contextWindow: 131_072, maxOutput: 4096, vision: false, tools: true, pricing: { inputPer1M: 0.54, outputPer1M: 0.54 }, aliases: ["nemotron-70b"] },
  // ── Other providers ───────────────────────────────────────────────────────
  { name: "perplexity-sonar-pro", provider: "perplexity", contextWindow: 200_000, maxOutput: 4096, vision: false, tools: false, pricing: { inputPer1M: 3, outputPer1M: 15 }, aliases: [] },
  { name: "command-r-plus", provider: "cohere", contextWindow: 128_000, maxOutput: 4096, vision: false, tools: true, pricing: { inputPer1M: 2.5, outputPer1M: 10 }, aliases: ["command-r-plus-latest"] },
  { name: "jamba-1.5-large", provider: "ai21", contextWindow: 256_000, maxOutput: 4096, vision: false, tools: true, pricing: { inputPer1M: 2, outputPer1M: 8 }, aliases: [] },
];

const NAME_INDEX = new Map<string, ModelMetadata>();
const ALIAS_INDEX = new Map<string, ModelMetadata>();

for (const model of MODELS) {
  NAME_INDEX.set(model.name.toLowerCase(), model);
  for (const alias of model.aliases) {
    ALIAS_INDEX.set(alias.toLowerCase(), model);
  }
}

export function getModelMetadata(model: string): ModelMetadata | null {
  const lower = model.toLowerCase().trim();

  // Exact name match
  const exact = NAME_INDEX.get(lower);
  if (exact) return exact;

  // Alias match
  const aliasMatch = ALIAS_INDEX.get(lower);
  if (aliasMatch) return aliasMatch;

  // Substring match against known names/aliases
  for (const [key, entry] of NAME_INDEX) {
    if (key.includes(lower) || lower.includes(key)) return entry;
  }
  for (const [key, entry] of ALIAS_INDEX) {
    if (key.includes(lower) || lower.includes(key)) return entry;
  }

  return null;
}

/**
 * Resolve context window for a model name (Hermes-style resolution).
 *
 * Resolution order:
 *   1. Exact match in model metadata table → use its contextWindow
 *   2. Fuzzy substring match in DEFAULT_CONTEXT_LENGTHS → use that value
 *   3. Default fallback → 256K
 */
export function getContextWindow(model: string): number {
  // Step 1: Check full metadata table
  const meta = getModelMetadata(model);
  if (meta) return meta.contextWindow;

  // Step 2: Fuzzy substring match (longest key first, most specific wins)
  const lower = model.toLowerCase();
  for (const [key, length] of FUZZY_KEYS) {
    if (lower.includes(key)) return length;
  }

  // Step 3: Default fallback (Hermes uses 256K)
  return DEFAULT_FALLBACK_CONTEXT;
}

export function listModelsByProvider(provider: string): ModelMetadata[] {
  const lower = provider.toLowerCase().trim();
  return MODELS.filter(m => m.provider.toLowerCase() === lower);
}
