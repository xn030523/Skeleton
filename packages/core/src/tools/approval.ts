/**
 * Command approval system — Hermes-style two-tier detection + approval flow.
 * Tier 1: Hardline blacklist (unconditional block)
 * Tier 2: Dangerous patterns (require approval)
 */

export type ApprovalScope = "once" | "session" | "always";

export interface ApprovalResult {
  approved: boolean;
  reason?: string;
}

/** Tools that are always safe — skip approval */
const SAFE_TOOLS = new Set([
  "identify",
  "hexdump",
  "strings",
  "entropy",
  "search_memory",
  "get_user_profile",
  "session_search",
  "recent_sessions",
  "set_task",
  "update_step",
  "add_working_note",
  "skill_manage",  // list action is safe
  "cron_manage",   // list action is safe
  "consolidate_memories",
]);

/** Hardline: patterns that are unconditionally blocked */
const HARDLINE_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /rm\s+-rf\s+\/(\s|$)/, reason: "Recursive root delete" },
  { pattern: /mkfs\b/, reason: "Filesystem format" },
  { pattern: /dd\s+.*of=\/dev\//, reason: "Raw block device write" },
  { pattern: /:\(\)\{\s*:\|:\&\s*\}\s*;/, reason: "Fork bomb" },
  { pattern: /\bkill\s+-1\b/, reason: "HUP all processes" },
  { pattern: /\b(reboot|halt|poweroff)\b/, reason: "System shutdown" },
];

/** Dangerous: patterns that require approval */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[rf]+\s+|.*--recursive)/, reason: "Recursive delete" },
  { pattern: /\bchmod\s+(777|666)\b/, reason: "Overly permissive chmod" },
  { pattern: /\bDROP\s+TABLE\b/i, reason: "SQL DROP TABLE" },
  { pattern: /\bDELETE\s+FROM\b[^;]*;/i, reason: "SQL DELETE without WHERE check" },
  { pattern: /curl\s+.*\|\s*(sh|bash|python)/, reason: "Pipe download to shell" },
  { pattern: /\bgit\s+(push\s+--force|reset\s+--hard|clean\s+-f)/, reason: "Destructive git operation" },
];

export class ApprovalSystem {
  private sessionApproved = new Set<string>();
  private permanentApproved = new Set<string>();
  private approvalCallback: ((toolName: string, args: Record<string, unknown>, reason: string) => Promise<boolean>) | null = null;

  /** Set the approval callback — CLI uses interactive prompt, TG uses confirmation message */
  onApprovalRequest(
    cb: (toolName: string, args: Record<string, unknown>, reason: string) => Promise<boolean>,
  ): void {
    this.approvalCallback = cb;
  }

  /** Check if a tool call requires approval, and if approved */
  async checkApproval(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<ApprovalResult> {
    // Safe tools skip approval
    if (SAFE_TOOLS.has(toolName)) {
      // But check for dangerous action in skill_manage/cron_manage
      if (toolName === "skill_manage" && String(args.action) === "list") {
        return { approved: true };
      }
      if (toolName === "cron_manage" && String(args.action) === "list") {
        return { approved: true };
      }
    }

    // Check for command content that needs scanning
    const commandStr = this.extractCommandString(toolName, args);
    if (commandStr) {
      const normalized = this.normalizeCommand(commandStr);

      // Tier 1: Hardline — unconditional block
      for (const rule of HARDLINE_PATTERNS) {
        if (rule.pattern.test(normalized)) {
          return { approved: false, reason: `BLOCKED: ${rule.reason}` };
        }
      }

      // Tier 2: Dangerous — require approval
      for (const rule of DANGEROUS_PATTERNS) {
        if (rule.pattern.test(normalized)) {
          return this.requestApproval(toolName, args, rule.reason);
        }
      }
    }

    // Tools that modify state always require approval for destructive actions
    if (toolName === "skill_manage" && ["delete", "remove_file"].includes(String(args.action))) {
      return this.requestApproval(toolName, args, `Skill ${args.action} operation`);
    }

    // File-writing tools need approval
    if (toolName === "write_file" || toolName === "remove_file") {
      return this.requestApproval(toolName, args, "File modification");
    }

    return { approved: true };
  }

  /** Approve a tool for the session */
  approveSession(toolKey: string): void {
    this.sessionApproved.add(toolKey);
  }

  /** Approve a tool permanently */
  approvePermanent(toolKey: string): void {
    this.permanentApproved.add(toolKey);
  }

  private async requestApproval(
    toolName: string,
    args: Record<string, unknown>,
    reason: string,
  ): Promise<ApprovalResult> {
    // Check if already approved for session or permanently
    const key = this.makeKey(toolName, args);
    if (this.sessionApproved.has(key) || this.permanentApproved.has(key)) {
      return { approved: true };
    }

    // Ask via callback
    if (this.approvalCallback) {
      const approved = await this.approvalCallback(toolName, args, reason);
      if (approved) {
        this.sessionApproved.add(key);
        return { approved: true };
      }
      return { approved: false, reason: `User denied: ${reason}` };
    }

    // No callback configured — auto-approve (running in non-interactive mode)
    return { approved: true };
  }

  private makeKey(toolName: string, args: Record<string, unknown>): string {
    return `${toolName}:${JSON.stringify(args)}`;
  }

  private extractCommandString(toolName: string, args: Record<string, unknown>): string | null {
    // Extract the command that will be executed for shell-based tools
    if (args.command) return String(args.command);
    if (args.args) {
      const arr = Array.isArray(args.args) ? args.args : [args.args];
      return [args.command, ...arr].filter(Boolean).join(" ");
    }
    return null;
  }

  /** Normalize command for detection — strip obfuscation */
  private normalizeCommand(cmd: string): string {
    return cmd
      // Strip ANSI escape sequences
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
      // Strip null bytes
      .replace(/\0/g, "")
      // Normalize Unicode fullwidth to ASCII
      .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
      // Collapse whitespace
      .replace(/\s+/g, " ")
      .trim();
  }
}
