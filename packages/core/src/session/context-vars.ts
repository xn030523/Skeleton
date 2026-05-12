/**
 * Session Context Variables — session-scoped key-value store.
 *
 * Port of Hermes `gateway/session_context.py` (adapted for Node.js).
 *
 * Hermes uses Python `contextvars.ContextVar` for async task-local isolation.
 * Node.js is single-threaded so we use a Map<sessionId, Map<key, value>>.
 * The semantics are equivalent: each session gets its own isolated store.
 *
 * Resolution order (mirrors Hermes get_session_env):
 *   1. Session store (set via setSessionEnv)
 *   2. process.env fallback (CLI / cron compatibility)
 *   3. default value
 */

const SESSION_STORES = new Map<string, Map<string, string>>();

/** Get a session-scoped environment variable.
 *  Falls back to process.env then `defaultValue` (Hermes os.environ fallback). */
export function getSessionEnv(key: string, sessionId: string, defaultValue = ""): string {
  const stored = SESSION_STORES.get(sessionId)?.get(key);
  if (stored !== undefined) return stored;
  // Fallback to process.env for CLI / cron compatibility
  return process.env[key] ?? defaultValue;
}

/** Set a session-scoped environment variable */
export function setSessionEnv(key: string, value: string, sessionId: string): void {
  if (!SESSION_STORES.has(sessionId)) {
    SESSION_STORES.set(sessionId, new Map());
  }
  SESSION_STORES.get(sessionId)!.set(key, value);
}

/** Delete a session-scoped variable */
export function deleteSessionEnv(key: string, sessionId: string): boolean {
  return SESSION_STORES.get(sessionId)?.delete(key) ?? false;
}

/** Get all session-scoped variables as a plain object */
export function getSessionEnvAll(sessionId: string): Record<string, string> {
  const store = SESSION_STORES.get(sessionId);
  if (!store) return {};
  return Object.fromEntries(store.entries());
}

/** Clean up all variables for a session */
export function clearSessionEnv(sessionId: string): void {
  SESSION_STORES.delete(sessionId);
}

/** Set multiple session variables at once (mirrors Hermes set_session_vars). */
export function setSessionVars(
  sessionId: string,
  vars: Record<string, string>,
): void {
  for (const [key, value] of Object.entries(vars)) {
    setSessionEnv(key, value, sessionId);
  }
}

/** Clear all session variables (mirrors Hermes clear_session_vars). */
export function clearSessionVars(sessionId: string): void {
  clearSessionEnv(sessionId);
}
