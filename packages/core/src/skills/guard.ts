/**
 * Skills Guard — security scanner for external skills before loading.
 * Detects dangerous shell commands, sensitive file access, network
 * exfiltration, and environment variable leaks.
 */

export type RiskLevel = "safe" | "low" | "medium" | "high" | "critical";

export interface ScanResult {
  riskLevel: RiskLevel;
  findings: ScanFinding[];
  summary: string;
}

export interface ScanFinding {
  category: "dangerous_command" | "sensitive_file" | "network_exfil" | "env_leak";
  pattern: string;
  line: number;
  description: string;
}

export interface PermissionCheck {
  allowed: boolean;
  denied: string[];
  warnings: string[];
}

interface SkillPermissionDef {
  name: string;
  permissions?: string[];
}

const DANGEROUS_COMMANDS = [
  /\brm\s+(-[rf]+\s+.*--no-preserve-root|.*\/\s*$)/,
  /\brm\s+-rf\s+/,
  /\bcurl\s+.*\|\s*sh\b/,
  /\bcurl\s+.*\|\s*bash\b/,
  /\bwget\s+.*\|\s*sh\b/,
  /\bchmod\s+777\b/,
  /\bdd\s+.*of=\/dev\//,
  /\bmkfs\b/,
  /\b:\(\)\{\s*:\|:&\}/,
];

const SENSITIVE_FILES = [
  /\/etc\/passwd/,
  /\/etc\/shadow/,
  /\/etc\/sudoers/,
  /\.ssh\//,
  /\.gnupg\//,
  /\.aws\//,
  /\.env\b/,
  /\.credentials/,
  /id_rsa/,
  /id_ed25519/,
];

const NETWORK_EXFIL = [
  /\bcurl\s+.*--data\b/,
  /\bcurl\s+.*-d\s/,
  /\bwget\s+.*--post/,
  /\bnc\s+.*-e\b/,
  /\bncat\s+.*-e\b/,
  /\bsocket\.connect\b/,
  /\bfetch\s*\(\s*['"](https?:\/\/(?!localhost|127\.0\.0\.1))/,
];

const ENV_LEAKS = [
  /\bprocess\.env\b/,
  /\$ENV\b/,
  /\$\{?HOME\}?\b/,
  /\bgetenv\b/,
  /\bprintenv\b/,
  /\bexport\s+\w+=.*\$/,
];

function matchPatterns(content: string, patterns: RegExp[], category: ScanFinding["category"]): ScanFinding[] {
  const findings: ScanFinding[] = [];
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    for (const pat of patterns) {
      if (pat.test(lines[i])) {
        findings.push({
          category,
          pattern: pat.source,
          line: i + 1,
          description: `Matched pattern: ${pat.source}`,
        });
      }
    }
  }

  return findings;
}

const RISK_ORDER: RiskLevel[] = ["safe", "low", "medium", "high", "critical"];

function highestRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

function findingsToRisk(findings: ScanFinding[]): RiskLevel {
  if (findings.length === 0) return "safe";
  let risk: RiskLevel = "low";
  for (const f of findings) {
    let r: RiskLevel;
    switch (f.category) {
      case "dangerous_command":
        r = "critical";
        break;
      case "sensitive_file":
        r = "high";
        break;
      case "network_exfil":
        r = "high";
        break;
      case "env_leak":
        r = "medium";
        break;
    }
    risk = highestRisk(risk, r);
  }
  return risk;
}

export class SkillsGuard {
  /** Scan skill content for security issues */
  scanSkill(content: string): ScanResult {
    const findings: ScanFinding[] = [
      ...matchPatterns(content, DANGEROUS_COMMANDS, "dangerous_command"),
      ...matchPatterns(content, SENSITIVE_FILES, "sensitive_file"),
      ...matchPatterns(content, NETWORK_EXFIL, "network_exfil"),
      ...matchPatterns(content, ENV_LEAKS, "env_leak"),
    ];

    const riskLevel = findingsToRisk(findings);

    return {
      riskLevel,
      findings,
      summary: findings.length === 0
        ? "No security issues found"
        : `Found ${findings.length} issue(s), risk level: ${riskLevel}`,
    };
  }

  /** Check a skill's declared permissions against a policy */
  checkPermissions(skillDef: SkillPermissionDef, allowed?: string[]): PermissionCheck {
    const denied: string[] = [];
    const warnings: string[] = [];
    const permissions = skillDef.permissions ?? [];

    const dangerousPerms = [
      "shell:execute",
      "fs:write",
      "network:outbound",
      "env:read",
      "fs:read-etc",
      "fs:read-ssh",
    ];

    for (const perm of permissions) {
      if (dangerousPerms.includes(perm)) {
        warnings.push(`Permission "${perm}" is potentially dangerous`);
      }
      if (allowed && !allowed.includes(perm)) {
        denied.push(perm);
      }
    }

    return {
      allowed: denied.length === 0,
      denied,
      warnings,
    };
  }
}
