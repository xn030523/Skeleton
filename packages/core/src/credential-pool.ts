/**
 * Multi-credential pool for same-provider failover.
 *
 * Supports fill_first, round_robin, least_used, and random strategies.
 * Auto-rotates on auth errors (401/403) and rate limits (429).
 * Cooldown: 5min for 401, 1hr for 429/402, 1hr default.
 * Inspired by Hermes credential_pool.py (simplified — no OAuth refresh).
 */

export type PoolStrategy = "fill_first" | "round_robin" | "least_used" | "random";

export interface PooledCredential {
  id: string;
  apiKey: string;
  baseUrl?: string;
  label: string;
  source: string;
  priority: number;
  requestCount: number;
  lastStatus: "ok" | "exhausted" | null;
  lastStatusAt: number | null;
  lastErrorCode: number | null;
  lastErrorResetAt: number | null;
}

const STATUS_OK = "ok" as const;
const STATUS_EXHAUSTED = "exhausted" as const;

const COOLDOWN_401 = 5 * 60 * 1000;       // 5 minutes
const COOLDOWN_429 = 60 * 60 * 1000;      // 1 hour
const COOLDOWN_DEFAULT = 60 * 60 * 1000;  // 1 hour

function cooldownMs(errorCode: number | null): number {
  if (errorCode === 401 || errorCode === 403) return COOLDOWN_401;
  if (errorCode === 429 || errorCode === 402) return COOLDOWN_429;
  return COOLDOWN_DEFAULT;
}

function exhaustedUntil(entry: PooledCredential): number | null {
  if (entry.lastStatus !== STATUS_EXHAUSTED) return null;
  const resetAt = entry.lastErrorResetAt;
  if (resetAt != null && resetAt > 0) return resetAt;
  if (entry.lastStatusAt) return entry.lastStatusAt + cooldownMs(entry.lastErrorCode);
  return null;
}

let _counter = 0;
function nextId(): string {
  return `cred_${++_counter}_${Date.now().toString(36)}`;
}

export class CredentialPool {
  private entries: PooledCredential[];
  private currentId: string | null = null;
  private strategy: PoolStrategy;

  constructor(entries: Array<{ apiKey: string; baseUrl?: string; label?: string }>, strategy: PoolStrategy = "fill_first") {
    this.strategy = strategy;
    this.entries = entries.map((e, i) => ({
      id: nextId(),
      apiKey: e.apiKey,
      baseUrl: e.baseUrl,
      label: e.label ?? `key-${i + 1}`,
      source: "config",
      priority: i,
      requestCount: 0,
      lastStatus: null as PooledCredential["lastStatus"],
      lastStatusAt: null as PooledCredential["lastStatusAt"],
      lastErrorCode: null as PooledCredential["lastErrorCode"],
      lastErrorResetAt: null as PooledCredential["lastErrorResetAt"],
    }));
  }

  hasCredentials(): boolean {
    return this.entries.length > 0;
  }

  hasAvailable(): boolean {
    return this.availableEntries().length > 0;
  }

  entriesList(): PooledCredential[] {
    return [...this.entries];
  }

  current(): PooledCredential | null {
    if (!this.currentId) return null;
    return this.entries.find(e => e.id === this.currentId) ?? null;
  }

  private availableEntries(): PooledCredential[] {
    const now = Date.now();
    // Clear expired cooldowns
    for (const entry of this.entries) {
      if (entry.lastStatus === STATUS_EXHAUSTED) {
        const until = exhaustedUntil(entry);
        if (until !== null && now >= until) {
          entry.lastStatus = STATUS_OK;
          entry.lastStatusAt = null;
          entry.lastErrorCode = null;
          entry.lastErrorResetAt = null;
        }
      }
    }
    return this.entries.filter(e => e.lastStatus !== STATUS_EXHAUSTED);
  }

  select(): PooledCredential | null {
    const available = this.availableEntries();
    if (available.length === 0) {
      this.currentId = null;
      return null;
    }

    let chosen: PooledCredential;
    switch (this.strategy) {
      case "random":
        chosen = available[Math.floor(Math.random() * available.length)];
        break;
      case "least_used":
        chosen = available.reduce((a, b) => a.requestCount <= b.requestCount ? a : b);
        chosen.requestCount++;
        break;
      case "round_robin": {
        // Rotate: move current to end, pick first available
        if (this.currentId) {
          const curIdx = this.entries.findIndex(e => e.id === this.currentId);
          if (curIdx >= 0 && curIdx < this.entries.length - 1) {
            const [moved] = this.entries.splice(curIdx, 1);
            this.entries.push(moved);
            // Re-index priorities
            for (let i = 0; i < this.entries.length; i++) this.entries[i].priority = i;
          }
        }
        chosen = available[0];
        chosen.requestCount++;
        break;
      }
      case "fill_first":
      default:
        chosen = available[0];
        chosen.requestCount++;
        break;
    }

    this.currentId = chosen.id;
    return chosen;
  }

  peek(): PooledCredential | null {
    const cur = this.current();
    if (cur && cur.lastStatus !== STATUS_EXHAUSTED) return cur;
    const available = this.availableEntries();
    return available[0] ?? null;
  }

  markExhaustedAndRotate(statusCode: number, resetAt?: number): PooledCredential | null {
    const entry = this.current() ?? this.select();
    if (!entry) return null;

    entry.lastStatus = STATUS_EXHAUSTED;
    entry.lastStatusAt = Date.now();
    entry.lastErrorCode = statusCode;
    entry.lastErrorResetAt = resetAt ?? null;

    console.warn(`Credential pool: marked "${entry.label}" exhausted (status=${statusCode}), rotating`);
    this.currentId = null;

    const next = this.select();
    if (next) console.log(`Credential pool: rotated to "${next.label}"`);
    return next;
  }

  resetStatuses(): number {
    let count = 0;
    for (const entry of this.entries) {
      if (entry.lastStatus || entry.lastStatusAt || entry.lastErrorCode) {
        entry.lastStatus = null;
        entry.lastStatusAt = null;
        entry.lastErrorCode = null;
        entry.lastErrorResetAt = null;
        count++;
      }
    }
    return count;
  }

  addEntry(apiKey: string, baseUrl?: string, label?: string): PooledCredential {
    const entry: PooledCredential = {
      id: nextId(),
      apiKey,
      baseUrl,
      label: label ?? `key-${this.entries.length + 1}`,
      source: "manual",
      priority: this.entries.length,
      requestCount: 0,
      lastStatus: null,
      lastStatusAt: null,
      lastErrorCode: null,
      lastErrorResetAt: null,
    };
    this.entries.push(entry);
    return entry;
  }

  removeEntry(id: string): boolean {
    const idx = this.entries.findIndex(e => e.id === id);
    if (idx < 0) return false;
    this.entries.splice(idx, 1);
    if (this.currentId === id) this.currentId = null;
    return true;
  }
}

/**
 * Build a CredentialPool from YAML config.
 *
 * Supports `apiKeys` array in llm config:
 *   llm:
 *     apiKeys: [sk-xxx, sk-yyy]
 *     credentialStrategy: round_robin
 *
 * Falls back to single apiKey if apiKeys is not set.
 */
export function buildCredentialPool(
  config: { apiKey: string; baseUrl?: string; apiKeys?: string[]; credentialStrategy?: PoolStrategy },
): CredentialPool {
  const keys = config.apiKeys ?? [config.apiKey];
  const entries = keys.map((key, i) => ({
    apiKey: key,
    baseUrl: config.baseUrl,
    label: `key-${i + 1}`,
  }));
  return new CredentialPool(entries, config.credentialStrategy ?? "fill_first");
}
