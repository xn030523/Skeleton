/**
 * Cross-session rate limit guard for Nous Portal.
 *
 * Port of Hermes `agent/nous_rate_guard.py`.
 *
 * Writes rate limit state to a shared file so all sessions (CLI, TG, cron,
 * auxiliary) can check whether Nous Portal is currently rate-limited before
 * making requests. Prevents retry amplification when RPH is tapped.
 *
 * Each 429 from Nous can trigger up to 9 API calls per turn (3 SDK retries
 * × 3 Skeleton retries). By recording the state on first 429 and checking
 * before subsequent attempts, we eliminate the amplification effect.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const STATE_DIR = path.join(os.homedir(), ".skeleton", "rate_limits");
const STATE_FILE = path.join(STATE_DIR, "nous.json");
const DEFAULT_COOLDOWN_SEC = 300;
const MIN_RESET_FOR_BREAKER_SEC = 60;

interface NousRateLimitState {
  resetAt: number;
  recordedAt: number;
  resetSeconds: number;
}

function parseResetSeconds(headers: Record<string, string> | undefined): number | null {
  if (!headers) return null;
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;
  for (const key of ["x-ratelimit-reset-requests-1h", "x-ratelimit-reset-requests", "retry-after"]) {
    const raw = lower[key];
    if (raw !== undefined) {
      const val = parseFloat(raw);
      if (Number.isFinite(val) && val > 0) return val;
    }
  }
  return null;
}

/** Record that Nous Portal is rate-limited. */
export function recordNousRateLimit(opts: {
  headers?: Record<string, string>;
  defaultCooldown?: number;
} = {}): void {
  const now = Date.now() / 1000;
  const headerSec = parseResetSeconds(opts.headers);
  const resetAt = headerSec !== null ? now + headerSec : now + (opts.defaultCooldown ?? DEFAULT_COOLDOWN_SEC);

  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const state: NousRateLimitState = { resetAt, recordedAt: now, resetSeconds: resetAt - now };
    const tmp = STATE_FILE + `.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(state), "utf-8");
    fs.renameSync(tmp, STATE_FILE);
  } catch { /* non-critical */ }
}

/** Returns seconds remaining until reset, or null if not rate-limited. */
export function nousRateLimitRemaining(): number | null {
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf-8");
    const state = JSON.parse(raw) as NousRateLimitState;
    const remaining = state.resetAt - Date.now() / 1000;
    if (remaining > 0) return remaining;
    try { fs.unlinkSync(STATE_FILE); } catch { /* */ }
    return null;
  } catch {
    return null;
  }
}

/** Clear the rate limit state (e.g. after a successful Nous request). */
export function clearNousRateLimit(): void {
  try { fs.unlinkSync(STATE_FILE); } catch { /* */ }
}

export function formatRemaining(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
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

/**
 * Decide whether a 429 from Nous Portal is a genuine account rate limit
 * (vs. transient upstream provider capacity issue).
 *
 * Returns true when evidence points at a real quota exhaustion.
 */
export function isGenuineNousRateLimit(headers: Record<string, string> | undefined): boolean {
  if (!headers) return false;
  const lower: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v;

  for (const tag of ["requests", "requests-1h", "tokens", "tokens-1h"]) {
    const remainingRaw = lower[`x-ratelimit-remaining-${tag}`];
    const resetRaw = lower[`x-ratelimit-reset-${tag}`];
    if (remainingRaw === undefined) continue;
    const remaining = parseInt(remainingRaw, 10);
    const reset = resetRaw !== undefined ? parseFloat(resetRaw) : null;
    if (remaining === 0 && reset !== null && reset >= MIN_RESET_FOR_BREAKER_SEC) return true;
  }
  return false;
}

/** True when the provider name or base URL looks like Nous Portal. */
export function isNousProvider(providerOrUrl: string | undefined | null): boolean {
  if (!providerOrUrl) return false;
  const s = providerOrUrl.toLowerCase();
  return s.includes("nous") || s.includes("nousresearch") || s.includes("api.nousresearch.com");
}
