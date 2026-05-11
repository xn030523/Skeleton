/**
 * ACP permission bridging — maps ACP approval requests to Skeleton approval callbacks.
 *
 * Aligned with Hermes acp_adapter/permissions.py.
 */

import type * as acp from "@agentclientprotocol/sdk";
import type * as schema from "@agentclientprotocol/sdk";
import { Logger } from "../logger/index.js";

const log = new Logger("acp:permissions");

// Maps ACP PermissionOptionKind → Skeleton approval result strings
const KIND_TO_SKELETON: Record<string, string> = {
  allow_once: "once",
  allow_always: "always",
  reject_once: "deny",
  reject_always: "deny",
};

export function makeApprovalCallback(
  conn: acp.AgentSideConnection,
  sessionId: string,
  timeout: number = 60000,
): (command: string, description: string) => Promise<string> {
  return async (command: string, _description: string): Promise<string> => {
    const options: schema.PermissionOption[] = [
      { optionId: "allow_once", kind: "allow_once", name: "Allow once" },
      { optionId: "allow_always", kind: "allow_always", name: "Allow always" },
      { optionId: "deny", kind: "reject_once", name: "Deny" },
    ];

    try {
      const response = await conn.requestPermission({
        sessionId,
        toolCall: {
          toolCallId: `perm-${Date.now()}`,
          title: command,
          kind: "execute",
          status: "pending",
          rawInput: { command },
        },
        options,
      });

      const outcome = response.outcome;
      if (!outcome) return "deny";

      // outcome is SelectedPermissionOutcome with optionId
      const optionId = (outcome as any).optionId;
      if (!optionId) {
        // outcome itself is the kind string (e.g. "allow_once")
        const kind = String(outcome);
        return KIND_TO_SKELETON[kind] ?? "deny";
      }

      // Find the matching option to get the kind
      for (const opt of options) {
        if (opt.optionId === optionId) {
          return KIND_TO_SKELETON[opt.kind] ?? "deny";
        }
      }
      return "once"; // fallback
    } catch (err) {
      log.error("Permission request failed", { error: (err as Error).message });
      return "deny";
    }
  };
}
