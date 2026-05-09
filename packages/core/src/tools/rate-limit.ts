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
  { prefix: "x-ratelimit-limit-requests", dimension: "rpm", field: "limit" },
  { prefix: "x-ratelimit-limit-tokens", dimension: "tpm", field: "limit" },
  { prefix: "x-ratelimit-remaining-requests", dimension: "rpm", field: "remaining" },
  { prefix: "x-ratelimit-remaining-tokens", dimension: "tpm", field: "remaining" },
  { prefix: "x-ratelimit-reset-requests", dimension: "rpm", field: "reset" },
  { prefix: "x-ratelimit-reset-tokens", dimension: "tpm", field: "reset" },
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
