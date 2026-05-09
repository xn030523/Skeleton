/**
 * Prompt Builder Security — scan context file content for prompt injection patterns.
 *
 * Detects: invisible unicode characters, ANSI escape sequences, role-spoofing
 * patterns, excessive length, and known attack patterns before content is
 * injected into the system prompt.
 */

interface ScanResult {
  safe: boolean;
  warnings: string[];
  sanitized?: string;
}

const INVISIBLE_UNICODE_RANGES: Array<{ range: RegExp; name: string }> = [
  { range: new RegExp("[\\u200B-\\u200F\\u2028-\\u202F\\u2060-\\u206F]", "g"), name: "Zero-width / format characters" },
  { range: new RegExp("[\\uFE00-\\uFE0F]", "g"), name: "Variation selectors" },
  { range: new RegExp("[\\uFFF0-\\uFFFB]", "g"), name: "Specials block" },
  { range: new RegExp("[\\uE000-\\uF8FF]", "g"), name: "Private Use Area" },
];

const ANSI_ESCAPE_RE = /\x1B\[[0-9;]*[A-Za-z]/g;

const ROLE_SPOOF_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /^you\s+are\s+/im, reason: "Role assignment pattern" },
  { pattern: /^SYSTEM:/im, reason: "System tag spoof" },
  { pattern: /^ASSISTANT:/im, reason: "Assistant tag spoof" },
  { pattern: /^USER:/im, reason: "User tag spoof" },
  { pattern: /<\s*system\s*>/i, reason: "System tag injection" },
  { pattern: /<\s*\/\s*system\s*>/i, reason: "System close tag injection" },
  { pattern: /<\s*role\s*>/i, reason: "Role tag injection" },
  { pattern: /ignore\s+(previous|above|all)\s+(instructions|rules|constraints)/i, reason: "Instruction override" },
  { pattern: /forget\s+(your|previous|above|all)\s+(instructions|rules)/i, reason: "Instruction discard" },
  { pattern: /disregard\s+(your|previous|above|all)\s+(instructions|rules)/i, reason: "Instruction disregard" },
];

const ATTACK_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /sudo\s+rm\s+-rf/i, reason: "Destructive command" },
  { pattern: /curl\s+.*\|\s*(sh|bash|python)/i, reason: "Pipe download to shell" },
  { pattern: /\beval\s*\(/i, reason: "Code evaluation" },
  { pattern: /exec\s*\(/i, reason: "Code execution" },
  { pattern: /process\.env\[/i, reason: "Environment access" },
  { pattern: /require\s*\(\s*['"]child_process/i, reason: "Child process import" },
];

const MAX_SAFE_LENGTH = 100_000;

/** Scan context file content for prompt injection patterns */
export function scanContextContent(content: string, source?: string): ScanResult {
  const warnings: string[] = [];
  let sanitized = content;

  const label = source ? ` (from ${source})` : "";

  // Check excessive length
  if (content.length > MAX_SAFE_LENGTH) {
    warnings.push(`Content length ${content.length} exceeds safe threshold ${MAX_SAFE_LENGTH}${label}`);
    sanitized = sanitized.slice(0, MAX_SAFE_LENGTH);
  }

  // Detect invisible unicode characters
  for (const { range, name } of INVISIBLE_UNICODE_RANGES) {
    range.lastIndex = 0;
    if (range.test(content)) {
      warnings.push(`Invisible unicode detected: ${name}${label}`);
      range.lastIndex = 0;
      sanitized = sanitized.replace(range, "");
    }
  }

  // Detect ANSI escape sequences
  ANSI_ESCAPE_RE.lastIndex = 0;
  if (ANSI_ESCAPE_RE.test(content)) {
    warnings.push(`ANSI escape sequences detected${label}`);
    ANSI_ESCAPE_RE.lastIndex = 0;
    sanitized = sanitized.replace(ANSI_ESCAPE_RE, "");
  }

  // Detect role-spoofing patterns
  for (const { pattern, reason } of ROLE_SPOOF_PATTERNS) {
    if (pattern.test(content)) {
      warnings.push(`${reason}${label}`);
    }
  }

  // Detect known attack patterns
  for (const { pattern, reason } of ATTACK_PATTERNS) {
    if (pattern.test(content)) {
      warnings.push(`${reason}${label}`);
    }
  }

  const safe = warnings.length === 0;

  return {
    safe,
    warnings,
    sanitized: safe ? undefined : sanitized,
  };
}
