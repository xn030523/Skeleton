/**
 * Tool call guardrail controller — detects tool loops, no-progress situations,
 * and repeated failures. Ported from Hermes tool_guardrails.py pattern.
 */

export interface GuardrailConfig {
  exactFailureWarnAfter: number;
  exactFailureBlockAfter: number;
  sameToolFailureWarnAfter: number;
  sameToolFailureHaltAfter: number;
  noProgressWarnAfter: number;
  noProgressBlockAfter: number;
}

const DEFAULT_CONFIG: GuardrailConfig = {
  exactFailureWarnAfter: 2,
  exactFailureBlockAfter: 5,
  sameToolFailureWarnAfter: 3,
  sameToolFailureHaltAfter: 8,
  noProgressWarnAfter: 6,
  noProgressBlockAfter: 12,
};

const IDEMPOTENT_TOLS = new Set([
  "identify", "hexdump", "strings", "entropy", "pe_info", "elf_info",
  "web_search", "web_fetch", "search_memory", "get_user_profile",
  "session_search", "recent_sessions", "skill_view", "skill_resource",
  "mcp_manage", "cron_manage", "list", "builtin", "probe",
]);

interface ToolCallRecord {
  name: string;
  args: Record<string, unknown>;
  result: "success" | "error" | "blocked";
  timestamp: number;
}

export class ToolCallGuardrail {
  private config: GuardrailConfig;
  private history: ToolCallRecord[] = [];
  private warnings: string[] = [];

  constructor(config?: Partial<GuardrailConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Record a tool call result */
  record(name: string, args: Record<string, unknown>, result: "success" | "error" | "blocked"): void {
    this.history.push({ name, args, result, timestamp: Date.now() });
  }

  /** Check if a tool call should be allowed. Returns { allow, reason? } */
  check(name: string, args: Record<string, unknown>): { allow: boolean; reason?: string } {
    // Exact failure: same tool + same args returning errors repeatedly
    const exactKey = this.makeKey(name, args);
    const exactFailures = this.history.filter(
      (r) => r.result === "error" && this.makeKey(r.name, r.args) === exactKey,
    ).length;

    if (exactFailures >= this.config.exactFailureBlockAfter) {
      return { allow: false, reason: `Tool "${name}" has failed ${exactFailures} times with same args — halting to prevent loop` };
    }
    if (exactFailures >= this.config.exactFailureWarnAfter) {
      this.addWarning(`Tool "${name}" failing repeatedly with same args (${exactFailures}x)`);
    }

    // Same tool failure: same tool returning errors with different args
    const sameToolFailures = this.history.filter(
      (r) => r.result === "error" && r.name === name,
    ).length;

    if (sameToolFailures >= this.config.sameToolFailureHaltAfter) {
      return { allow: false, reason: `Tool "${name}" has failed ${sameToolFailures} times total — halting to prevent waste` };
    }
    if (sameToolFailures >= this.config.sameToolFailureWarnAfter) {
      this.addWarning(`Tool "${name}" failing frequently (${sameToolFailures}x)`);
    }

    // No-progress detection: only mutating tools called with no idempotent reads
    const recent = this.history.slice(-this.config.noProgressBlockAfter);
    const recentMutating = recent.filter((r) => !IDEMPOTENT_TOLS.has(r.name));
    if (recent.length >= this.config.noProgressBlockAfter && recentMutating.length === recent.length) {
      return { allow: false, reason: "Only mutating tools called recently with no reads — likely stuck in a loop" };
    }
    const recentWarn = this.history.slice(-this.config.noProgressWarnAfter);
    const recentMutatingWarn = recentWarn.filter((r) => !IDEMPOTENT_TOLS.has(r.name));
    if (recentWarn.length >= this.config.noProgressWarnAfter && recentMutatingWarn.length === recentWarn.length) {
      this.addWarning("Only mutating tools called recently — consider reading state before making changes");
    }

    return { allow: true };
  }

  /** Get and clear accumulated warnings */
  drainWarnings(): string[] {
    const w = [...this.warnings];
    this.warnings = [];
    return w;
  }

  /** Reset state (e.g., on new session) */
  reset(): void {
    this.history = [];
    this.warnings = [];
  }

  private makeKey(name: string, args: Record<string, unknown>): string {
    return `${name}:${JSON.stringify(args)}`;
  }

  private addWarning(msg: string): void {
    if (!this.warnings.includes(msg)) {
      this.warnings.push(msg);
    }
  }
}
