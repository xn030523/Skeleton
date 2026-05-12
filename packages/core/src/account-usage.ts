/**
 * Account usage tracker — provider quota tracking by day/month periods.
 * Tracks input/output tokens per provider+model, checks quota limits.
 */

export interface UsageRecord {
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  timestamp: number;
}

export interface QuotaConfig {
  /** Max input tokens per period */
  maxInputTokens?: number;
  /** Max output tokens per period */
  maxOutputTokens?: number;
  /** Max total tokens per period */
  maxTotalTokens?: number;
  /** Period: "day" or "month" */
  period: "day" | "month";
}

interface ProviderQuota {
  config: QuotaConfig;
  records: UsageRecord[];
}

export class AccountUsageTracker {
  private providers: Map<string, ProviderQuota> = new Map();

  /** Set quota config for a provider */
  setQuota(provider: string, config: QuotaConfig): void {
    const existing = this.providers.get(provider);
    if (existing) {
      existing.config = config;
    } else {
      this.providers.set(provider, { config, records: [] });
    }
  }

  /** Track usage for a provider+model */
  trackUsage(provider: string, model: string, inputTokens: number, outputTokens: number): UsageRecord {
    let entry = this.providers.get(provider);
    if (!entry) {
      entry = { config: { period: "month" }, records: [] };
      this.providers.set(provider, entry);
    }
    const record: UsageRecord = {
      provider,
      model,
      inputTokens,
      outputTokens,
      timestamp: Date.now(),
    };
    entry.records.push(record);
    return record;
  }

  /** Get aggregated usage for a provider in a period */
  getUsage(provider: string, period?: "day" | "month"): {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    recordCount: number;
  } {
    const entry = this.providers.get(provider);
    if (!entry) return { inputTokens: 0, outputTokens: 0, totalTokens: 0, recordCount: 0 };

    const periodType = period ?? entry.config.period;
    const cutoff = this.periodCutoff(periodType);
    const records = entry.records.filter(r => r.timestamp >= cutoff);

    const inputTokens = records.reduce((s, r) => s + r.inputTokens, 0);
    const outputTokens = records.reduce((s, r) => s + r.outputTokens, 0);
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      recordCount: records.length,
    };
  }

  /** Check if a provider has exceeded its quota */
  checkQuota(provider: string): { exceeded: boolean; usage: { inputTokens: number; outputTokens: number; totalTokens: number }; limits: QuotaConfig } {
    const entry = this.providers.get(provider);
    const config = entry?.config ?? { period: "month" as const };
    const usage = this.getUsage(provider);
    let exceeded = false;

    if (config.maxInputTokens != null && usage.inputTokens > config.maxInputTokens) exceeded = true;
    if (config.maxOutputTokens != null && usage.outputTokens > config.maxOutputTokens) exceeded = true;
    if (config.maxTotalTokens != null && usage.totalTokens > config.maxTotalTokens) exceeded = true;

    return { exceeded, usage, limits: config };
  }

  /** Get all configured provider names */
  listProviders(): string[] {
    return [...this.providers.keys()];
  }

  /** Prune records older than the longest configured period */
  prune(): number {
    let pruned = 0;
    for (const [, entry] of this.providers) {
      const cutoff = this.periodCutoff(entry.config.period);
      const before = entry.records.length;
      entry.records = entry.records.filter(r => r.timestamp >= cutoff);
      pruned += before - entry.records.length;
    }
    return pruned;
  }

  private periodCutoff(period: "day" | "month"): number {
    const now = Date.now();
    if (period === "day") return now - 86400000;
    return now - 30 * 86400000;
  }
}

// ── Real provider account usage queries (Hermes fetch_account_usage) ─────────

export interface AccountUsageWindow {
  label: string;
  usedPercent: number;
  resetAt?: string;
  detail?: string;
}

export interface AccountUsageSnapshot {
  provider: string;
  source: string;
  fetchedAt: string;
  windows: AccountUsageWindow[];
  details: string[];
  unavailableReason?: string;
}

async function fetchOpenRouterUsage(baseUrl: string, apiKey: string): Promise<AccountUsageSnapshot | null> {
  if (!apiKey) return null;
  const base = (baseUrl || "https://openrouter.ai/api/v1").replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${apiKey}`, Accept: "application/json" };
  try {
    const [creditsResp, keyResp] = await Promise.all([
      fetch(`${base}/credits`, { headers, signal: AbortSignal.timeout(10_000) }),
      fetch(`${base}/key`, { headers, signal: AbortSignal.timeout(10_000) }).catch(() => null),
    ]);
    if (!creditsResp.ok) return null;
    const credits = ((await creditsResp.json()) as any)?.data ?? {};
    const keyData = keyResp?.ok ? (((await keyResp.json()) as any)?.data ?? {}) : {};

    const totalCredits = parseFloat(credits.total_credits ?? 0);
    const totalUsage = parseFloat(credits.total_usage ?? 0);
    const details = [`Credits balance: $${Math.max(0, totalCredits - totalUsage).toFixed(2)}`];
    const windows: AccountUsageWindow[] = [];

    const limit = parseFloat(keyData.limit ?? 0);
    const limitRemaining = parseFloat(keyData.limit_remaining ?? 0);
    if (limit > 0 && limitRemaining >= 0 && limitRemaining <= limit) {
      windows.push({
        label: "API key quota",
        usedPercent: ((limit - limitRemaining) / limit) * 100,
        detail: `$${limitRemaining.toFixed(2)} of $${limit.toFixed(2)} remaining`,
        resetAt: keyData.limit_reset ?? undefined,
      });
    }
    return { provider: "openrouter", source: "credits_api", fetchedAt: new Date().toISOString(), windows, details };
  } catch {
    return null;
  }
}

async function fetchAnthropicUsage(apiKey: string): Promise<AccountUsageSnapshot | null> {
  if (!apiKey) return null;
  // Only works for OAuth tokens (Claude.ai accounts), not API keys
  if (!apiKey.startsWith("sk-ant-oat")) {
    return {
      provider: "anthropic",
      source: "oauth_usage_api",
      fetchedAt: new Date().toISOString(),
      windows: [],
      details: [],
      unavailableReason: "Anthropic account limits are only available for OAuth-backed Claude accounts.",
    };
  }
  try {
    const resp = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!resp.ok) return null;
    const payload = await resp.json() as Record<string, any>;
    const windows: AccountUsageWindow[] = [];
    for (const [key, label] of [
      ["five_hour", "Current session"],
      ["seven_day", "Current week"],
    ] as Array<[string, string]>) {
      const w = payload[key] ?? {};
      const util = w.utilization;
      if (util == null) continue;
      const pct = parseFloat(util) <= 1 ? parseFloat(util) * 100 : parseFloat(util);
      windows.push({ label, usedPercent: pct, resetAt: w.resets_at ?? undefined });
    }
    return { provider: "anthropic", source: "oauth_usage_api", fetchedAt: new Date().toISOString(), windows, details: [] };
  } catch {
    return null;
  }
}

/**
 * Fetch real account usage from the provider's API.
 * Port of Hermes `agent/account_usage.py fetch_account_usage`.
 * Returns null for unsupported providers or on error.
 */
export async function fetchAccountUsage(
  provider: string,
  opts: { baseUrl?: string; apiKey?: string } = {},
): Promise<AccountUsageSnapshot | null> {
  const p = provider.trim().toLowerCase();
  if (!p || p === "auto" || p === "custom") return null;
  try {
    if (p === "openrouter") return fetchOpenRouterUsage(opts.baseUrl ?? "https://openrouter.ai/api/v1", opts.apiKey ?? "");
    if (p === "anthropic") return fetchAnthropicUsage(opts.apiKey ?? "");
  } catch {
    return null;
  }
  return null;
}

/** Format an AccountUsageSnapshot for terminal display. */
export function formatAccountUsage(snapshot: AccountUsageSnapshot): string {
  if (snapshot.unavailableReason) return `  ${snapshot.provider}: ${snapshot.unavailableReason}`;
  const lines: string[] = [`  ${snapshot.provider} account usage:`];
  for (const w of snapshot.windows) {
    const bar = "█".repeat(Math.floor(w.usedPercent / 5)) + "░".repeat(20 - Math.floor(w.usedPercent / 5));
    lines.push(`    ${w.label.padEnd(18)} [${bar}] ${w.usedPercent.toFixed(1)}%${w.resetAt ? ` (resets ${w.resetAt})` : ""}`);
    if (w.detail) lines.push(`      ${w.detail}`);
  }
  for (const d of snapshot.details) lines.push(`    ${d}`);
  return lines.join("\n");
}
