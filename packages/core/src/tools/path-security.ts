/**
 * Path Security — path traversal detection and working directory boundary validation.
 *
 * Prevents: directory traversal via .., symlink escapes, absolute path injection.
 *
 * Inspired by Hermes path_security.py.
 */

import path from "node:path";

/** Check if a path contains traversal components */
export function hasTraversalComponent(filePath: string): boolean {
  const normalized = path.normalize(filePath);
  const parts = normalized.split(/[/\\]/);
  return parts.some(p => p === "..");
}

/** Validate that a resolved path stays within an allowed directory */
export function validateWithinDir(
  filePath: string,
  allowedDir: string,
): { valid: boolean; resolved?: string; reason?: string } {
  const resolved = path.resolve(filePath);
  const allowedResolved = path.resolve(allowedDir);

  if (!resolved.startsWith(allowedResolved + path.sep) && resolved !== allowedResolved) {
    return {
      valid: false,
      resolved,
      reason: `Path "${resolved}" escapes allowed directory "${allowedResolved}"`,
    };
  }

  if (hasTraversalComponent(filePath)) {
    return {
      valid: false,
      resolved,
      reason: `Path contains directory traversal (..) components`,
    };
  }

  return { valid: true, resolved };
}

/** Sanitize a path by removing traversal components */
export function sanitizePath(filePath: string): string {
  return path.normalize(filePath).replace(/\.\./g, "__");
}

/** Check if a path looks like it targets a sensitive system location */
export function isSystemPath(filePath: string): boolean {
  const normalized = path.normalize(filePath).toLowerCase();
  return normalized.startsWith("/etc/") ||
    normalized.startsWith("/var/") ||
    normalized.startsWith("/usr/") ||
    normalized.startsWith("/boot/") ||
    normalized.startsWith("/proc/") ||
    normalized.startsWith("/sys/") ||
    normalized.startsWith("c:\\windows\\") ||
    normalized.startsWith("c:\\program files\\") ||
    normalized.startsWith("c:\\programdata\\");
}
