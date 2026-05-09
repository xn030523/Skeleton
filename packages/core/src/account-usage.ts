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
