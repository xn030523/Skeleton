/**
 * Regex-based secret redaction for logs and tool output.
 *
 * Masks API keys, tokens, and credentials before they reach
 * log files or verbose output. Short tokens (<18 chars) are
 * fully masked; longer tokens preserve first 6 + last 4 chars.
 * Ported from Hermes redact.py (simplified).
 */

// Known API key prefixes
const PREFIX_PATTERNS = [
  /sk-[A-Za-z0-9_-]{10,}/g,           // OpenAI / OpenRouter / Anthropic
  /ghp_[A-Za-z0-9]{10,}/g,            // GitHub PAT (classic)
  /github_pat_[A-Za-z0-9_]{10,}/g,    // GitHub PAT (fine-grained)
  /gho_[A-Za-z0-9]{10,}/g,            // GitHub OAuth
  /ghs_[A-Za-z0-9]{10,}/g,            // GitHub server-to-server
  /xox[baprs]-[A-Za-z0-9-]{10,}/g,    // Slack tokens
  /AIza[A-Za-z0-9_-]{30,}/g,          // Google API keys
  /AKIA[A-Z0-9]{16}/g,                // AWS Access Key ID
  /sk_live_[A-Za-z0-9]{10,}/g,        // Stripe live key
  /sk_test_[A-Za-z0-9]{10,}/g,        // Stripe test key
  /hf_[A-Za-z0-9]{10,}/g,             // HuggingFace
  /gsk_[A-Za-z0-9]{10,}/g,            // Groq Cloud
  /pplx-[A-Za-z0-9]{10,}/g,           // Perplexity
  /fal_[A-Za-z0-9_-]{10,}/g,          // Fal.ai
  /npm_[A-Za-z0-9]{10,}/g,            // npm token
];

// ENV assignment: API_KEY=xxx
const SECRET_ENV_NAMES = /(?:API_?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/;
const ENV_ASSIGN_RE = new RegExp(
  `([A-Z0-9_]{0,50}${SECRET_ENV_NAMES.source}[A-Z0-9_]{0,50})\\s*=\\s*(['"]?)(\\S+)\\2`,
  "g",
);

// JSON field: "apiKey": "xxx"
const JSON_KEY_NAMES = /(?:api_?[Kk]ey|token|secret|password|access_token|refresh_token|bearer|private_key)/;
const JSON_FIELD_RE = new RegExp(
  `("${JSON_KEY_NAMES.source}")\\s*:\\s*"([^"]+)"`,
  "gi",
);

// Authorization headers
const AUTH_HEADER_RE = /(Authorization:\s*Bearer\s+)(\S+)/gi;

// Private key blocks
const PRIVATE_KEY_RE = /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g;

// Database connection strings: postgres://user:PASS@host
const DB_CONNSTR_RE = /((?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis|amqp):\/\/[^:]+:)([^@]+)(@)/gi;

// JWT tokens: eyJ...
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_=-]{4,}){0,2}/g;

// URL userinfo: https://user:pass@host
const URL_USERINFO_RE = /(https?|wss?|ftp):\/\/([^/\s:@]+):([^/\s@]+)@/g;

// Snapshot at import time — runtime env mutations cannot disable
const REDACT_ENABLED = (() => {
  const val = process.env.SKELETON_REDACT_SECRETS ?? "true";
  return ["1", "true", "yes", "on"].includes(val.toLowerCase());
})();

function maskToken(token: string): string {
  if (!token) return "***";
  if (token.length < 18) return "***";
  return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

/**
 * Redact secrets from a string. Safe on non-matching text.
 * Set force=true for safety boundaries that must never return raw secrets.
 */
export function redactSensitiveText(text: string, { force = false }: { force?: boolean } = {}): string {
  if (!text || typeof text !== "string") return text;
  if (!force && !REDACT_ENABLED) return text;

  // Known prefixes
  for (const re of PREFIX_PATTERNS) {
    re.lastIndex = 0;
    text = text.replace(re, (m) => maskToken(m));
  }

  // ENV assignments
  ENV_ASSIGN_RE.lastIndex = 0;
  text = text.replace(ENV_ASSIGN_RE, (_, name, quote, value) => `${name}=${quote}${maskToken(value)}${quote}`);

  // JSON fields
  JSON_FIELD_RE.lastIndex = 0;
  text = text.replace(JSON_FIELD_RE, (_, key, value) => `${key}: "${maskToken(value)}"`);

  // Auth headers
  AUTH_HEADER_RE.lastIndex = 0;
  text = text.replace(AUTH_HEADER_RE, (_, prefix, token) => prefix + maskToken(token));

  // Private key blocks
  PRIVATE_KEY_RE.lastIndex = 0;
  text = text.replace(PRIVATE_KEY_RE, "[REDACTED PRIVATE KEY]");

  // DB connection strings
  DB_CONNSTR_RE.lastIndex = 0;
  text = text.replace(DB_CONNSTR_RE, (_, prefix, _pass, suffix) => `${prefix}***${suffix}`);

  // JWTs
  JWT_RE.lastIndex = 0;
  text = text.replace(JWT_RE, (m) => maskToken(m));

  // URL userinfo
  URL_USERINFO_RE.lastIndex = 0;
  text = text.replace(URL_USERINFO_RE, (_, scheme, user, _pass) => `${scheme}://${user}:***@`);

  return text;
}

/**
 * Mask a secret for display, preserving head and tail characters.
 */
export function maskSecret(value: string, { head = 4, tail = 4, floor = 12 }: { head?: number; tail?: number; floor?: number } = {}): string {
  if (!value) return "";
  if (value.length < floor) return "***";
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
}
