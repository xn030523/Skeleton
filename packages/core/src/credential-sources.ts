/**
 * Credential source resolution — 12 source types (v1 implements 5).
 * env_var, env_file, config_file, api_key_file, prompt are active;
 * remaining 7 return null with a warning.
 * Inspired by Hermes credential_sources.py.
 */

export type CredentialSourceType =
  | "env_var"
  | "env_file"
  | "keyring"
  | "vault"
  | "aws_secrets"
  | "gcp_secret_manager"
  | "azure_key_vault"
  | "config_file"
  | "cli_auth"
  | "oauth_token"
  | "api_key_file"
  | "prompt";

export interface CredentialSourceConfig {
  type: CredentialSourceType;
  name: string;
  /** env var name (env_var), file path (env_file/api_key_file), config key (config_file), prompt message (prompt) */
  ref: string;
  /** Optional fallback value */
  fallback?: string;
  /** For config_file: which key inside the file */
  key?: string;
}

const IMPLEMENTED: Set<CredentialSourceType> = new Set([
  "env_var",
  "env_file",
  "config_file",
  "api_key_file",
  "prompt",
]);

function warnUnimplemented(type: CredentialSourceType): null {
  console.warn(`Credential source "${type}" is not implemented in v1 — returning null`);
  return null;
}

function resolveEnvVar(config: CredentialSourceConfig): string | null {
  const value = process.env[config.ref];
  if (value) return value;
  if (config.fallback != null) return config.fallback;
  return null;
}

function resolveEnvFile(config: CredentialSourceConfig): string | null {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const content = fs.readFileSync(config.ref, "utf-8").trim();
    return content || (config.fallback ?? null);
  } catch {
    return config.fallback ?? null;
  }
}

function resolveConfigFile(config: CredentialSourceConfig): string | null {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const raw = fs.readFileSync(config.ref, "utf-8");
    let data: Record<string, unknown>;
    if (config.ref.endsWith(".json")) {
      data = JSON.parse(raw);
    } else {
      // Minimal YAML-like: key=value pairs
      data = {};
      for (const line of raw.split("\n")) {
        const m = line.match(/^([^#=]+)=(.*)$/);
        if (m) data[m[1].trim()] = m[2].trim();
      }
    }
    const key = config.key ?? "api_key";
    const value = data[key];
    if (typeof value === "string" && value) return value;
    return config.fallback ?? null;
  } catch {
    return config.fallback ?? null;
  }
}

function resolveApiKeyFile(config: CredentialSourceConfig): string | null {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const content = fs.readFileSync(config.ref, "utf-8").trim();
    return content || (config.fallback ?? null);
  } catch {
    return config.fallback ?? null;
  }
}

function resolvePrompt(config: CredentialSourceConfig): string | null {
  // In non-interactive mode, return fallback or null
  if (config.fallback != null) return config.fallback;
  console.warn(`Credential source "prompt" requires interactive input for "${config.name}" — no value available`);
  return null;
}

/** Resolve a credential from the specified source config */
export function resolveCredential(config: CredentialSourceConfig): string | null {
  if (!IMPLEMENTED.has(config.type)) {
    return warnUnimplemented(config.type);
  }
  switch (config.type) {
    case "env_var":
      return resolveEnvVar(config);
    case "env_file":
      return resolveEnvFile(config);
    case "config_file":
      return resolveConfigFile(config);
    case "api_key_file":
      return resolveApiKeyFile(config);
    case "prompt":
      return resolvePrompt(config);
    default:
      return null;
  }
}

/** List all supported credential source types with their implementation status */
export function listCredentialSources(): Array<{ type: CredentialSourceType; implemented: boolean }> {
  const all: CredentialSourceType[] = [
    "env_var", "env_file", "keyring", "vault", "aws_secrets",
    "gcp_secret_manager", "azure_key_vault", "config_file",
    "cli_auth", "oauth_token", "api_key_file", "prompt",
  ];
  return all.map(type => ({ type, implemented: IMPLEMENTED.has(type) }));
}
