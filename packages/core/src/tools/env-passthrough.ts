/**
 * Env Passthrough — session-scoped allowlist for environment variables.
 *
 * Skill-declared required_environment_variables and user-configured overrides
 * pass through to sandboxes. Prevents cross-session data bleed by scoping
 * registrations to specific sessions.
 */

const GLOBAL_SESSION = "__global__";

const passthroughRegistry = new Map<string, Set<string>>();

function resolveSession(sessionId?: string): string {
  return sessionId ?? GLOBAL_SESSION;
}

/** Register an environment variable key for passthrough to sandboxes */
export function registerEnvPassthrough(key: string, sessionId?: string): void {
  const session = resolveSession(sessionId);
  if (!passthroughRegistry.has(session)) {
    passthroughRegistry.set(session, new Set());
  }
  passthroughRegistry.get(session)!.add(key);
}

/** Check if an environment variable key is allowed through for the given session */
export function isEnvPassthrough(key: string, sessionId?: string): boolean {
  const session = resolveSession(sessionId);
  const sessionKeys = passthroughRegistry.get(session);
  if (sessionKeys?.has(key)) return true;

  if (session !== GLOBAL_SESSION) {
    const globalKeys = passthroughRegistry.get(GLOBAL_SESSION);
    if (globalKeys?.has(key)) return true;
  }

  return false;
}

/** Collect all passthrough env vars as key-value pairs for the given session */
export function getPassthroughEnv(sessionId?: string): Record<string, string> {
  const session = resolveSession(sessionId);
  const result: Record<string, string> = {};

  const globalKeys = passthroughRegistry.get(GLOBAL_SESSION);
  if (globalKeys) {
    for (const key of globalKeys) {
      if (process.env[key] !== undefined) {
        result[key] = process.env[key]!;
      }
    }
  }

  if (session !== GLOBAL_SESSION) {
    const sessionKeys = passthroughRegistry.get(session);
    if (sessionKeys) {
      for (const key of sessionKeys) {
        if (process.env[key] !== undefined) {
          result[key] = process.env[key]!;
        }
      }
    }
  }

  return result;
}
