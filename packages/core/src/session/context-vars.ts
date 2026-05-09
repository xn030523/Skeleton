/**
 * Session Context Variables — session-scoped key-value store
 * that avoids race conditions in concurrent multi-session scenarios.
 *
 * Inspired by Hermes session_context.py (simplified — uses Map).
 */

const SESSION_STORES = new Map<string, Map<string, string>>();

/** Get a session-scoped environment variable */
export function getSessionEnv(key: string, sessionId: string): string | undefined {
  return SESSION_STORES.get(sessionId)?.get(key);
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
