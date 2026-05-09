export interface CostEstimate {
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  reasoningCost: number;
  totalCost: number;
  currency: string;
}

interface PricingEntry {
  inputPer1M: number;
  outputPer1M: number;
  cacheReadPer1M?: number;
  cacheWritePer1M?: number;
  reasoningPer1M?: number;
}

const PRICING_TABLE: Record<string, PricingEntry> = {
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
  "gpt-4.1": { inputPer1M: 2, outputPer1M: 8, cacheReadPer1M: 0.5, cacheWritePer1M: 8 },
  "gpt-4.1-mini": { inputPer1M: 0.4, outputPer1M: 1.6, cacheReadPer1M: 0.1, cacheWritePer1M: 1.6 },
  "gpt-4.1-nano": { inputPer1M: 0.1, outputPer1M: 0.4, cacheReadPer1M: 0.025, cacheWritePer1M: 0.4 },
  "gpt-4-turbo": { inputPer1M: 10, outputPer1M: 30 },
  "gpt-4": { inputPer1M: 30, outputPer1M: 60 },
  "gpt-3.5-turbo": { inputPer1M: 0.5, outputPer1M: 1.5 },
  "o1": { inputPer1M: 15, outputPer1M: 60, reasoningPer1M: 60 },
  "o1-mini": { inputPer1M: 3, outputPer1M: 12, reasoningPer1M: 12 },
  "o1-pro": { inputPer1M: 150, outputPer1M: 600, reasoningPer1M: 600 },
  "o3-mini": { inputPer1M: 1.1, outputPer1M: 4.4, cacheReadPer1M: 0.275, reasoningPer1M: 4.4 },
  "o4-mini": { inputPer1M: 1.1, outputPer1M: 4.4, cacheReadPer1M: 0.275, reasoningPer1M: 4.4 },
  "claude-sonnet-4-20250514": { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 },
  "claude-sonnet-4-20250514": { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 },
  "claude-3-5-sonnet-20241022": { inputPer1M: 3, outputPer1M: 15, cacheReadPer1M: 0.3, cacheWritePer1M: 3.75 },
  "claude-3-5-haiku-20241022": { inputPer1M: 0.8, outputPer1M: 4, cacheReadPer1M: 0.08, cacheWritePer1M: 1 },
  "claude-3-opus-20240229": { inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5, cacheWritePer1M: 18.75 },
  "claude-opus-4-20250514": { inputPer1M: 15, outputPer1M: 75, cacheReadPer1M: 1.5, cacheWritePer1M: 18.75 },
  "claude-3-haiku-20240307": { inputPer1M: 0.25, outputPer1M: 1.25, cacheReadPer1M: 0.03, cacheWritePer1M: 0.3 },
  "gemini-2.5-pro": { inputPer1M: 1.25, outputPer1M: 10, cacheReadPer1M: 0.35, cacheWritePer1M: 1.25, reasoningPer1M: 10 },
  "gemini-2.5-flash": { inputPer1M: 0.15, outputPer1M: 0.6, cacheReadPer1M: 0.0375, cacheWritePer1M: 0.15, reasoningPer1M: 0.6 },
  "gemini-2.0-flash": { inputPer1M: 0.1, outputPer1M: 0.4, cacheReadPer1M: 0.025, cacheWritePer1M: 0.1 },
  "gemini-1.5-pro": { inputPer1M: 1.25, outputPer1M: 5, cacheReadPer1M: 0.3125, cacheWritePer1M: 1.25 },
  "gemini-1.5-flash": { inputPer1M: 0.075, outputPer1M: 0.3, cacheReadPer1M: 0.01875, cacheWritePer1M: 0.075 },
  "deepseek-chat": { inputPer1M: 0.27, outputPer1M: 1.1, cacheReadPer1M: 0.07, cacheWritePer1M: 0.27 },
  "deepseek-reasoner": { inputPer1M: 0.55, outputPer1M: 2.19, cacheReadPer1M: 0.14, cacheWritePer1M: 0.55, reasoningPer1M: 2.19 },
  "mistral-large": { inputPer1M: 2, outputPer1M: 6 },
  "mistral-medium": { inputPer1M: 0.4, outputPer1M: 1.2 },
  "mistral-small": { inputPer1M: 0.1, outputPer1M: 0.3 },
  "llama-3.1-405b-instruct": { inputPer1M: 3, outputPer1M: 3 },
  "llama-3.1-70b-instruct": { inputPer1M: 0.54, outputPer1M: 0.54 },
  "llama-3.1-8b-instruct": { inputPer1M: 0.05, outputPer1M: 0.05 },
  "qwen-max": { inputPer1M: 1.6, outputPer1M: 6.4 },
  "qwen-plus": { inputPer1M: 0.4, outputPer1M: 1.2 },
  "qwen-turbo": { inputPer1M: 0.05, outputPer1M: 0.2 },
  "command-r-plus": { inputPer1M: 2.5, outputPer1M: 10 },
  "command-r": { inputPer1M: 0.5, outputPer1M: 1.5 },
};

const ALIASES: Record<string, string> = {
  "gpt4o": "gpt-4o",
  "gpt4o-mini": "gpt-4o-mini",
  "gpt4-turbo": "gpt-4-turbo",
  "gpt4": "gpt-4",
  "gpt35-turbo": "gpt-3.5-turbo",
  "gpt-35-turbo": "gpt-3.5-turbo",
  "sonnet": "claude-sonnet-4-20250514",
  "sonnet-4": "claude-sonnet-4-20250514",
  "claude-sonnet": "claude-sonnet-4-20250514",
  "claude-3.5-sonnet": "claude-3-5-sonnet-20241022",
  "claude-3-5-sonnet": "claude-3-5-sonnet-20241022",
  "haiku": "claude-3-5-haiku-20241022",
  "claude-haiku": "claude-3-5-haiku-20241022",
  "opus": "claude-opus-4-20250514",
  "claude-opus": "claude-opus-4-20250514",
  "deepseek-v3": "deepseek-chat",
  "deepseek-r1": "deepseek-reasoner",
  "gemini-pro": "gemini-2.5-pro",
  "gemini-flash": "gemini-2.5-flash",
};

function resolveModelName(model: string): string {
  const lower = model.toLowerCase().trim();
  if (PRICING_TABLE[lower]) return lower;
  if (ALIASES[lower]) return ALIASES[lower];

  for (const key of Object.keys(PRICING_TABLE)) {
    if (lower.includes(key) || key.includes(lower)) return key;
  }

  for (const [alias, canonical] of Object.entries(ALIASES)) {
    if (lower.includes(alias) || alias.includes(lower)) return canonical;
  }

  return lower;
}

export function estimateUsageCost(
  usage: { promptTokens: number; completionTokens: number; cachedTokens?: number },
  model: string,
  _provider?: string,
): CostEstimate {
  const resolved = resolveModelName(model);
  const pricing = PRICING_TABLE[resolved];

  if (!pricing) {
    return {
      inputCost: 0,
      outputCost: 0,
      cacheReadCost: 0,
      cacheWriteCost: 0,
      reasoningCost: 0,
      totalCost: 0,
      currency: "USD",
    };
  }

  const nonCachedInput = usage.promptTokens - (usage.cachedTokens ?? 0);
  const inputCost = (nonCachedInput / 1_000_000) * pricing.inputPer1M;
  const outputCost = (usage.completionTokens / 1_000_000) * pricing.outputPer1M;
  const cacheReadCost = usage.cachedTokens
    ? (usage.cachedTokens / 1_000_000) * (pricing.cacheReadPer1M ?? 0)
    : 0;
  const cacheWriteCost = 0;
  const reasoningCost = 0;

  return {
    inputCost: roundCents(inputCost),
    outputCost: roundCents(outputCost),
    cacheReadCost: roundCents(cacheReadCost),
    cacheWriteCost: roundCents(cacheWriteCost),
    reasoningCost: roundCents(reasoningCost),
    totalCost: roundCents(inputCost + outputCost + cacheReadCost + cacheWriteCost + reasoningCost),
    currency: "USD",
  };
}

function roundCents(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}
