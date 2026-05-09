/**
 * Error Classifier — structured taxonomy of API errors with
 * priority-ordered classification and recovery strategy selection.
 *
 * Determines: retry, rotate credential, fallback provider,
 * compress context, or abort. 15+ error categories.
 *
 * Inspired by Hermes error_classifier.py.
 */

export type RecoveryAction =
  | "retry"           // Transient error, backoff and retry
  | "rotate_credential" // Auth/rate-limit, try next credential
  | "fallback_provider" // Current provider failed, try fallback
  | "compress_context"  // Context too large, compress and retry
  | "abort";            // Unrecoverable, give up

export type ErrorCategory =
  | "auth_invalid_key"
  | "auth_expired_token"
  | "auth_forbidden"
  | "rate_limit_rpm"
  | "rate_limit_tpm"
  | "rate_limit_tpd"
  | "rate_limit_concurrent"
  | "context_too_long"
  | "context_window_exceeded"
  | "model_not_found"
  | "model_overloaded"
  | "server_error"
  | "server_timeout"
  | "server_unavailable"
  | "network_timeout"
  | "network_connection"
  | "network_dns"
  | "payload_too_large"
  | "invalid_request"
  | "tool_call_invalid"
  | "content_filter"
  | "quota_exceeded"
  | "billing_inactive"
  | "unknown";

export interface ClassifiedError {
  category: ErrorCategory;
  action: RecoveryAction;
  retryable: boolean;
  statusCode?: number;
  message: string;
  providerHint?: string;
}

const STATUS_MAP: Record<number, ErrorCategory> = {
  400: "invalid_request",
  401: "auth_invalid_key",
  402: "billing_inactive",
  403: "auth_forbidden",
  404: "model_not_found",
  408: "network_timeout",
  413: "payload_too_large",
  429: "rate_limit_rpm",
  500: "server_error",
  502: "server_unavailable",
  503: "model_overloaded",
  504: "network_timeout",
  529: "model_overloaded",
};

const MESSAGE_PATTERNS: Array<{ pattern: RegExp; category: ErrorCategory }> = [
  // Auth errors
  { pattern: /invalid api.?key/i, category: "auth_invalid_key" },
  { pattern: /incorrect api.?key/i, category: "auth_invalid_key" },
  { pattern: /authentication\s+fail/i, category: "auth_invalid_key" },
  { pattern: /expired\s+token/i, category: "auth_expired_token" },
  { pattern: /token\s+expired/i, category: "auth_expired_token" },
  { pattern: /access\s+denied/i, category: "auth_forbidden" },
  { pattern: /insufficient\s+permissions/i, category: "auth_forbidden" },
  // Rate limits
  { pattern: /rate\s+limit/i, category: "rate_limit_rpm" },
  { pattern: /too\s+many\s+requests/i, category: "rate_limit_rpm" },
  { pattern: /requests\s+per\s+minute/i, category: "rate_limit_rpm" },
  { pattern: /tokens\s+per\s+minute/i, category: "rate_limit_tpm" },
  { pattern: /tokens\s+per\s+day/i, category: "rate_limit_tpd" },
  { pattern: /concurrent\s+request/i, category: "rate_limit_concurrent" },
  { pattern: /quota\s+exceeded/i, category: "quota_exceeded" },
  { pattern: /billing\s+hard/i, category: "quota_exceeded" },
  { pattern: /credit\s+exhaust/i, category: "quota_exceeded" },
  { pattern: /plan\s+limit/i, category: "quota_exceeded" },
  // Context errors
  { pattern: /context\s+length\s+exceed/i, category: "context_window_exceeded" },
  { pattern: /context\s+too\s+long/i, category: "context_window_exceeded" },
  { pattern: /maximum\s+context/i, category: "context_window_exceeded" },
  { pattern: /too\s+many\s+tokens/i, category: "context_window_exceeded" },
  { pattern: /token\s+limit/i, category: "context_too_long" },
  { pattern: /input\s+too\s+long/i, category: "context_too_long" },
  // Model errors
  { pattern: /model\s+not\s+found/i, category: "model_not_found" },
  { pattern: /model\s+does\s+not\s+exist/i, category: "model_not_found" },
  { pattern: /overloaded/i, category: "model_overloaded" },
  { pattern: /capacity/i, category: "model_overloaded" },
  // Server errors
  { pattern: /server\s+error/i, category: "server_error" },
  { pattern: /internal\s+server/i, category: "server_error" },
  { pattern: /service\s+unavailable/i, category: "server_unavailable" },
  { pattern: /bad\s+gateway/i, category: "server_unavailable" },
  // Network errors
  { pattern: /timeout|timed?\s*out/i, category: "network_timeout" },
  { pattern: /econnrefused|econnreset/i, category: "network_connection" },
  { pattern: /connection\s+refused/i, category: "network_connection" },
  { pattern: /connection\s+reset/i, category: "network_connection" },
  { pattern: /econnaborted/i, category: "network_connection" },
  { pattern: /enotfound|dns/i, category: "network_dns" },
  { pattern: /fetch\s+failed/i, category: "network_connection" },
  // Content filter
  { pattern: /content\s+filter/i, category: "content_filter" },
  { pattern: /safety\s+filter/i, category: "content_filter" },
  { pattern: /flagged/i, category: "content_filter" },
  // Billing
  { pattern: /billing\s+inactive/i, category: "billing_inactive" },
  { pattern: /account\s+suspended/i, category: "billing_inactive" },
  // Tool call errors
  { pattern: /invalid\s+tool/i, category: "tool_call_invalid" },
  { pattern: /tool\s+call\s+fail/i, category: "tool_call_invalid" },
  { pattern: /function\s+call\s+invalid/i, category: "tool_call_invalid" },
];

const ACTION_MAP: Record<ErrorCategory, RecoveryAction> = {
  auth_invalid_key: "rotate_credential",
  auth_expired_token: "rotate_credential",
  auth_forbidden: "abort",
  rate_limit_rpm: "rotate_credential",
  rate_limit_tpm: "rotate_credential",
  rate_limit_tpd: "fallback_provider",
  rate_limit_concurrent: "retry",
  context_too_long: "compress_context",
  context_window_exceeded: "compress_context",
  model_not_found: "fallback_provider",
  model_overloaded: "retry",
  server_error: "retry",
  server_timeout: "retry",
  server_unavailable: "retry",
  network_timeout: "retry",
  network_connection: "retry",
  network_dns: "retry",
  payload_too_large: "compress_context",
  invalid_request: "abort",
  tool_call_invalid: "abort",
  content_filter: "abort",
  quota_exceeded: "rotate_credential",
  billing_inactive: "fallback_provider",
  unknown: "retry",
};

const RETRYABLE: Set<ErrorCategory> = new Set([
  "rate_limit_rpm", "rate_limit_tpm", "rate_limit_concurrent",
  "model_overloaded", "server_error", "server_timeout", "server_unavailable",
  "network_timeout", "network_connection", "network_dns",
  "unknown",
]);

/** Classify an error into a structured taxonomy with recovery strategy */
export function classifyError(err: unknown): ClassifiedError {
  const msg = (err as Error)?.message ?? String(err);
  const status = (err as { status?: number })?.status;
  const statusCode = (err as { statusCode?: number })?.statusCode;
  const code = status ?? statusCode;

  // 1. Status code match (highest priority)
  if (code && STATUS_MAP[code]) {
    const category = STATUS_MAP[code];
    return {
      category,
      action: ACTION_MAP[category],
      retryable: RETRYABLE.has(category),
      statusCode: code,
      message: msg,
    };
  }

  // 2. Message pattern match
  for (const { pattern, category } of MESSAGE_PATTERNS) {
    if (pattern.test(msg)) {
      return {
        category,
        action: ACTION_MAP[category],
        retryable: RETRYABLE.has(category),
        statusCode: code,
        message: msg,
      };
    }
  }

  // 3. Default
  return {
    category: "unknown",
    action: "retry",
    retryable: true,
    statusCode: code,
    message: msg,
  };
}

/** Jittered exponential backoff for decorrelated retries */
export function jitteredBackoff(
  attempt: number,
  baseMs: number = 1000,
  maxMs: number = 60000,
): number {
  const exp = Math.min(baseMs * Math.pow(2, attempt), maxMs);
  const jitter = exp * (0.5 + Math.random() * 0.5);
  return Math.floor(jitter);
}
