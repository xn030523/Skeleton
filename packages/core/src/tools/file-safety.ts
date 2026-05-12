/**
 * File Safety Rules — blocks writes to sensitive paths.
 *
 * Denies writes to: .ssh/, .aws/, .env, id_rsa, authorized_keys,
 * /etc/sudoers, .gnupg/, .kube/, .docker/, .azure/, .config/gh/, etc.
 *
 * Inspired by Hermes file_safety.py.
 */

import path from "node:path";

const DENIED_PATHS = [
  "authorized_keys", "id_rsa", "id_ed25519", "id_ecdsa", "id_dsa",
  "known_hosts", ".env", ".bashrc", ".bash_profile", ".profile",
  ".zshrc", ".zprofile", ".zshenv", ".zlogout",
  ".bash_logout", ".inputrc", ".login",
  ".gitconfig", ".npmrc", ".pypirc",
  "sudoers", "shadow", "passwd", "hosts",
  ".netrc", ".curlrc", ".wgetrc", "credentials.json",
  "service-account-key.json", "gcloud-service-key.json",
  "secrets.yml", "secrets.yaml", "secrets.json",
  ".pgpass", ".my.cnf", ".mongoshrc.js",
  "token.json", "auth.json", "oauth.json",
];

const DENIED_PREFIXES = [
  ".ssh", ".aws", ".gnupg", ".kube", ".docker", ".azure",
  ".config/gh", ".config/gcloud", ".config/hub",
  ".config/op",       // 1Password CLI
  ".config/hermes",   // Hermes agent credentials
  ".local/share/keyrings",  // GNOME keyring
  "/etc/sudoers.d", "/etc/ssh", "/etc/pam.d",
  "/etc/systemd",    // systemd service files
  "/etc/cron.d", "/etc/cron.daily", "/etc/cron.weekly",
  // Skeleton-specific
  ".skeleton/credentials",
];

/** Check if a file path should be denied for write operations */
export function isWriteDenied(filePath: string): { denied: boolean; reason?: string } {
  const normalized = path.normalize(filePath);
  const base = path.basename(normalized);
  const lower = normalized.toLowerCase();

  // Check exact filename matches
  for (const denied of DENIED_PATHS) {
    if (base === denied || base === denied.toLowerCase()) {
      return { denied: true, reason: `Writing to "${denied}" is blocked for security` };
    }
  }

  // Check directory prefix matches
  for (const prefix of DENIED_PREFIXES) {
    const prefixLower = prefix.toLowerCase();
    if (lower.includes(prefixLower + path.sep) || lower.endsWith(prefixLower)) {
      // Allow if it's under a project node_modules or similar
      if (lower.includes("node_modules") || lower.includes(".git/objects")) {
        continue;
      }
      return { denied: true, reason: `Writing to "${prefix}/" directory is blocked for security` };
    }
  }

  // Check for private key patterns in filename
  if (/^(id__rsa|id_ed25519|id_ecdsa|id_dsa|\.pem|\.key)$/i.test(base)) {
    return { denied: true, reason: `Writing private key file "${base}" is blocked` };
  }

  return { denied: false };
}

/** Get all denied path patterns (for display/configuration) */
export function getDeniedPatterns(): { paths: string[]; prefixes: string[] } {
  return { paths: [...DENIED_PATHS], prefixes: [...DENIED_PREFIXES] };
}
