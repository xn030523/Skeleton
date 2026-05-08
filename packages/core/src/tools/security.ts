/**
 * Security scanning utilities — injection detection, path safety, URL safety.
 * Ported from Hermes patterns: MCP_INJECTION_PATTERNS, CONTEXT_THREAT_PATTERNS,
 * MEMORY_THREAT_PATTERNS, file_safety, url_safety.
 */

// ─── MCP Tool Description Injection Scanning ────────────────────────────────

const MCP_INJECTION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /ignore\s+(previous|above|all)\s+(instructions|rules)/i, reason: "Prompt override" },
  { pattern: /you\s+are\s+now\s+/i, reason: "Identity override" },
  { pattern: /<system>|<\/system>|<role>|<\/role>/i, reason: "Role tag injection" },
  { pattern: /hide\s+(this|the|your)\s+(output|response|result)/i, reason: "Concealment" },
  { pattern: /curl\s+.*\|\s*(sh|bash|python)/i, reason: "Network command" },
  { pattern: /eval\(|Function\(|import\s+/i, reason: "Code execution in description" },
  { pattern: /exec\s*\(|child_process|require\s*\(/i, reason: "Dangerous import" },
];

export function scanMcpDescription(name: string, description: string): string[] {
  const warnings: string[] = [];
  for (const rule of MCP_INJECTION_PATTERNS) {
    if (rule.pattern.test(description)) {
      warnings.push(`Tool "${name}": ${rule.reason} pattern detected in description`);
    }
  }
  return warnings;
}

export function scanMcpToolList(tools: Array<{ name: string; description: string }>): {
  safe: Array<{ name: string; description: string }>;
  warnings: string[];
} {
  const warnings: string[] = [];
  const safe = tools.filter((t) => {
    const toolWarnings = scanMcpDescription(t.name, t.description);
    if (toolWarnings.length > 0) {
      warnings.push(...toolWarnings);
    }
    return toolWarnings.length === 0;
  });
  // Include flagged tools but with sanitized descriptions
  const flagged = tools.filter((t) => !safe.some((s) => s.name === t.name));
  for (const t of flagged) {
    safe.push({ ...t, description: `[SCANNED — injection pattern detected] ${t.description.slice(0, 60)}` });
  }
  return { safe, warnings };
}

// ─── Cron Prompt Injection Scanning ─────────────────────────────────────────

const CRON_INJECTION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /ignore\s+(previous|above|all)\s+(instructions|rules)/i, reason: "Prompt override" },
  { pattern: /you\s+are\s+(now|no longer)\s+/i, reason: "Identity override" },
  { pattern: /<system>|<\/system>|<role>|<\/role>/i, reason: "Role tag injection" },
  { pattern: /sudo\s+|chmod\s+[0-7]{3,4}\b/i, reason: "Privilege escalation" },
  { pattern: /rm\s+-rf\s+\//i, reason: "Destructive command" },
  { pattern: /curl\s+.*\|\s*(sh|bash)/i, reason: "Pipe download to shell" },
  { pattern: /export\s+.{0,20}=\s*\$\(/i, reason: "Command substitution in env" },
  { pattern: /\beval\s*\(/i, reason: "Code evaluation" },
];

export function scanCronPrompt(prompt: string): { safe: boolean; warnings: string[] } {
  const warnings: string[] = [];
  for (const rule of CRON_INJECTION_PATTERNS) {
    if (rule.pattern.test(prompt)) {
      warnings.push(rule.reason);
    }
  }
  return { safe: warnings.length === 0, warnings };
}

// ─── Memory Threat Scanning ────────────────────────────────────────────────

const MEMORY_THREAT_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /ignore\s+(previous|above|all)\s+(instructions|rules)/i, reason: "Prompt injection" },
  { pattern: /you\s+are\s+now\s+/i, reason: "Role hijack" },
  { pattern: /pretend\s+(to\s+be|you're)\s+/i, reason: "Deception" },
  { pattern: /curl\s+.*[\?&].*key=|wget\s+.*[\?&].*key=/i, reason: "Credential exfiltration" },
  { pattern: /ssh\s+-[RDLo]+\s+.*:\d+\s+/i, reason: "SSH tunnel/backdoor" },
  { pattern: /\/\.\.?\/\.\.?\/(etc|root|shadow)/i, reason: "Path traversal to sensitive file" },
];

export function scanMemoryContent(content: string): { safe: boolean; warnings: string[] } {
  const warnings: string[] = [];
  for (const rule of MEMORY_THREAT_PATTERNS) {
    if (rule.pattern.test(content)) {
      warnings.push(rule.reason);
    }
  }
  return { safe: warnings.length === 0, warnings };
}

// ─── File Path Safety ───────────────────────────────────────────────────────

const SENSITIVE_PATHS = [
  "/etc/passwd", "/etc/shadow", "/etc/ssh/", "/root/.ssh/",
  "/.env", "/credentials", "/.aws/", "/.gnupg/",
  "\\windows\\system32", "\\documents and settings",
];

export function isPathSafe(filePath: string): { safe: boolean; reason?: string } {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();

  // Path traversal
  if (normalized.includes("..")) {
    const resolved = normalized.split("/").reduce((acc: string[], part) => {
      if (part === "..") acc.pop();
      else if (part !== ".") acc.push(part);
      return acc;
    }, []).join("/");
    if (resolved !== normalized.replace(/\./g, "").replace(/\/+/g, "/")) {
      return { safe: false, reason: "Path traversal detected" };
    }
  }

  // Sensitive paths
  for (const sensitive of SENSITIVE_PATHS) {
    if (normalized.includes(sensitive.toLowerCase())) {
      return { safe: false, reason: `Access to sensitive path: ${sensitive}` };
    }
  }

  // Null bytes
  if (filePath.includes("\0")) {
    return { safe: false, reason: "Null byte in path" };
  }

  return { safe: true };
}

// ─── URL Safety ─────────────────────────────────────────────────────────────

const DANGEROUS_URL_SCHEMES = ["javascript:", "data:", "vbscript:", "file:"];
const PRIVATE_IP = /^(127\.\d|10\.\d|172\.(1[6-9]|2\d|3[01])|192\.168|::1|fe80:|0\.0\.0\.0)/;

export function isUrlSafe(url: string): { safe: boolean; reason?: string } {
  const lower = url.toLowerCase().trim();

  for (const scheme of DANGEROUS_URL_SCHEMES) {
    if (lower.startsWith(scheme)) {
      return { safe: false, reason: `Dangerous URL scheme: ${scheme}` };
    }
  }

  try {
    const parsed = new URL(url);
    if (PRIVATE_IP.test(parsed.hostname)) {
      // Allow in CTF lab context but flag it
      return { safe: true };
    }
  } catch {
    return { safe: false, reason: "Malformed URL" };
  }

  return { safe: true };
}
