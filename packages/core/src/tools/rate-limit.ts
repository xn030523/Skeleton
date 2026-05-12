export interface RateLimitStatus {
  rpm: RateLimitDimension | null;
  rph: RateLimitDimension | null;
  tpm: RateLimitDimension | null;
  tph: RateLimitDimension | null;
  canMakeRequest: boolean;
}

export interface RateLimitDimension {
  limit: number;
  remaining: number;
  resetAt: number | null;
}

const HEADER_PATTERNS: Array<{
  prefix: string;
  dimension: "rpm" | "rph" | "tpm" | "tph";
  field: "limit" | "remaining" | "reset";
}> = [
  // Per-minute
  { prefix: "x-ratelimit-limit-requests", dimension: "rpm", field: "limit" },
  { prefix: "x-ratelimit-limit-tokens", dimension: "tpm", field: "limit" },
  { prefix: "x-ratelimit-remaining-requests", dimension: "rpm", field: "remaining" },
  { prefix: "x-ratelimit-remaining-tokens", dimension: "tpm", field: "remaining" },
  { prefix: "x-ratelimit-reset-requests", dimension: "rpm", field: "reset" },
  { prefix: "x-ratelimit-reset-tokens", dimension: "tpm", field: "reset" },
  // Per-hour (Hermes/Nous/OpenRouter -1h suffix)
  { prefix: "x-ratelimit-limit-requests-1h", dimension: "rph", field: "limit" },
  { prefix: "x-ratelimit-limit-tokens-1h", dimension: "tph", field: "limit" },
  { prefix: "x-ratelimit-remaining-requests-1h", dimension: "rph", field: "remaining" },
  { prefix: "x-ratelimit-remaining-tokens-1h", dimension: "tph", field: "remaining" },
  { prefix: "x-ratelimit-reset-requests-1h", dimension: "rph", field: "reset" },
  { prefix: "x-ratelimit-reset-tokens-1h", dimension: "tph", field: "reset" },
  // Legacy -rph/-tph suffix (kept for backward compat)
  { prefix: "x-ratelimit-limit-rph", dimension: "rph", field: "limit" },
  { prefix: "x-ratelimit-limit-tph", dimension: "tph", field: "limit" },
  { prefix: "x-ratelimit-remaining-rph", dimension: "rph", field: "remaining" },
  { prefix: "x-ratelimit-remaining-tph", dimension: "tph", field: "remaining" },
  { prefix: "x-ratelimit-reset-rph", dimension: "rph", field: "reset" },
  { prefix: "x-ratelimit-reset-tph", dimension: "tph", field: "reset" },
];

const GENERIC_LIMIT = "x-ratelimit-limit";
const GENERIC_REMAINING = "x-ratelimit-remaining";
const GENERIC_RESET = "x-ratelimit-reset";
const RETRY_AFTER = "retry-after";

export class RateLimitTracker {
  private dimensions: Record<string, RateLimitDimension | null> = {
    rpm: null,
    rph: null,
    tpm: null,
    tph: null,
  };
  private retryAfter: number | null = null;
  private lastParseTime = 0;

  parse(headers: Record<string, string>): void {
    this.lastParseTime = Date.now();
    this.retryAfter = null;

    for (const [key, value] of Object.entries(headers)) {
      const lowerKey = key.toLowerCase();

      for (const { prefix, dimension, field } of HEADER_PATTERNS) {
        if (lowerKey === prefix) {
          if (!this.dimensions[dimension]) {
            this.dimensions[dimension] = { limit: 0, remaining: 0, resetAt: null };
          }
          const dim = this.dimensions[dimension]!;

          if (field === "limit" || field === "remaining") {
            dim[field] = parseInt(value, 10) || 0;
          } else if (field === "reset") {
            dim.resetAt = this.parseResetValue(value);
          }
        }
      }

      if (lowerKey === GENERIC_LIMIT) {
        if (!this.dimensions.rpm) {
          this.dimensions.rpm = { limit: 0, remaining: 0, resetAt: null };
        }
        this.dimensions.rpm.limit = parseInt(value, 10) || 0;
      }

      if (lowerKey === GENERIC_REMAINING) {
        if (!this.dimensions.rpm) {
          this.dimensions.rpm = { limit: 0, remaining: 0, resetAt: null };
        }
        this.dimensions.rpm.remaining = parseInt(value, 10) || 0;
      }

      if (lowerKey === GENERIC_RESET) {
        if (!this.dimensions.rpm) {
          this.dimensions.rpm = { limit: 0, remaining: 0, resetAt: null };
        }
        this.dimensions.rpm.resetAt = this.parseResetValue(value);
      }

      if (lowerKey === RETRY_AFTER) {
        const seconds = parseInt(value, 10);
        if (!isNaN(seconds)) {
          this.retryAfter = Date.now() + seconds * 1000;
        }
      }
    }
  }

  getStatus(): RateLimitStatus {
    const now = Date.now();

    const adjustDimension = (dim: RateLimitDimension | null): RateLimitDimension | null => {
      if (!dim) return null;
      if (dim.resetAt && now >= dim.resetAt) {
        return { limit: dim.limit, remaining: dim.limit, resetAt: dim.resetAt };
      }
      const elapsed = now - this.lastParseTime;
      const windowElapsed = dim.resetAt ? dim.resetAt - this.lastParseTime : 60000;
      if (elapsed > 0 && windowElapsed > 0 && dim.limit > 0) {
        const recovered = Math.floor((elapsed / windowElapsed) * dim.limit);
        const adjustedRemaining = Math.min(dim.remaining + recovered, dim.limit);
        return { ...dim, remaining: adjustedRemaining };
      }
      return dim;
    };

    return {
      rpm: adjustDimension(this.dimensions.rpm),
      rph: adjustDimension(this.dimensions.rph),
      tpm: adjustDimension(this.dimensions.tpm),
      tph: adjustDimension(this.dimensions.tph),
      canMakeRequest: this.canMakeRequest(),
    };
  }

  canMakeRequest(): boolean {
    if (this.retryAfter && Date.now() < this.retryAfter) {
      return false;
    }

    const status = this.getStatusInternal();
    const dims = [status.rpm, status.rph, status.tpm, status.tph];
    for (const dim of dims) {
      if (dim && dim.remaining <= 0) {
        if (dim.resetAt && Date.now() >= dim.resetAt) continue;
        return false;
      }
    }
    return true;
  }

  private getStatusInternal(): Record<string, RateLimitDimension | null> {
    const now = Date.now();
    const result: Record<string, RateLimitDimension | null> = {};

    for (const [key, dim] of Object.entries(this.dimensions)) {
      if (!dim) {
        result[key] = null;
        continue;
      }
      if (dim.resetAt && now >= dim.resetAt) {
        result[key] = { limit: dim.limit, remaining: dim.limit, resetAt: dim.resetAt };
      } else {
        result[key] = dim;
      }
    }

    return result;
  }

  private parseResetValue(value: string): number | null {
    const num = parseInt(value, 10);
    if (!isNaN(num)) {
      if (num > 1e12) return num;
      if (num < 1e6) return Date.now() + num * 1000;
      return num;
    }

    const date = Date.parse(value);
    return isNaN(date) ? null : date;
  }
}

// ── Display helpers (Hermes format_rate_limit_display) ────────────────────

function fmtCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtSeconds(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return sec ? `${m}m ${sec}s` : `${m}m`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

function bar(pct: number, width = 20): string {
  const filled = Math.max(0, Math.min(width, Math.floor((pct / 100) * width)));
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

function bucketLine(label: string, dim: RateLimitDimension | null, now: number, labelWidth = 14): string {
  if (!dim || dim.limit <= 0) return `  ${label.padEnd(labelWidth)}  (no data)`;
  const used = dim.limit - dim.remaining;
  const pct = (used / dim.limit) * 100;
  const resetMs = dim.resetAt ? Math.max(0, dim.resetAt - now) : 0;
  return `  ${label.padEnd(labelWidth)} ${bar(pct)} ${pct.toFixed(1).padStart(5)}%  ${fmtCount(used)}/${fmtCount(dim.limit)} used  (${fmtCount(dim.remaining)} left, resets in ${fmtSeconds(resetMs)})`;
}

/** Format rate limit state for terminal display (Hermes format_rate_limit_display). */
export function formatRateLimitDisplay(tracker: RateLimitTracker, provider = ""): string {
  const status = tracker.getStatus();
  const now = Date.now();
  const providerLabel = provider ? provider.charAt(0).toUpperCase() + provider.slice(1) : "Provider";

  const lines = [
    `${providerLabel} Rate Limits:`,
    "",
    bucketLine("Requests/min", status.rpm, now),
    bucketLine("Requests/hr", status.rph, now),
    "",
    bucketLine("Tokens/min", status.tpm, now),
    bucketLine("Tokens/hr", status.tph, now),
  ];

  const warnings: string[] = [];
  for (const [label, dim] of [
    ["requests/min", status.rpm],
    ["requests/hr", status.rph],
    ["tokens/min", status.tpm],
    ["tokens/hr", status.tph],
  ] as Array<[string, RateLimitDimension | null]>) {
    if (dim && dim.limit > 0) {
      const pct = ((dim.limit - dim.remaining) / dim.limit) * 100;
      if (pct >= 80) {
        const resetMs = dim.resetAt ? Math.max(0, dim.resetAt - now) : 0;
        warnings.push(`  ⚠ ${label} at ${pct.toFixed(0)}% — resets in ${fmtSeconds(resetMs)}`);
      }
    }
  }
  if (warnings.length > 0) {
    lines.push("", ...warnings);
  }

  return lines.join("\n");
}

/** One-line compact summary for status bars. */
export function formatRateLimitCompact(tracker: RateLimitTracker): string {
  const status = tracker.getStatus();
  const now = Date.now();
  const parts: string[] = [];
  if (status.rpm?.limit) parts.push(`RPM: ${status.rpm.remaining}/${status.rpm.limit}`);
  if (status.rph?.limit) {
    const resetMs = status.rph.resetAt ? Math.max(0, status.rph.resetAt - now) : 0;
    parts.push(`RPH: ${fmtCount(status.rph.remaining)}/${fmtCount(status.rph.limit)} (resets ${fmtSeconds(resetMs)})`);
  }
  if (status.tpm?.limit) parts.push(`TPM: ${fmtCount(status.tpm.remaining)}/${fmtCount(status.tpm.limit)}`);
  if (status.tph?.limit) {
    const resetMs = status.tph.resetAt ? Math.max(0, status.tph.resetAt - now) : 0;
    parts.push(`TPH: ${fmtCount(status.tph.remaining)}/${fmtCount(status.tph.limit)} (resets ${fmtSeconds(resetMs)})`);
  }
  return parts.join(" | ") || "No rate limit data.";
}
