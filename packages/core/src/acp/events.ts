/**
 * ACP event bridge callbacks — bridge Skeleton Agent events to ACP notifications.
 *
 * Each factory returns a callable that pushes ACP session updates to the client
 * via conn.sessionUpdate().
 *
 * Aligned with Hermes acp_adapter/events.py.
 */

import type * as acp from "@agentclientprotocol/sdk";
import type * as schema from "@agentclientprotocol/sdk";
import { buildToolStart, buildToolComplete, makeToolCallId } from "./tools.js";
import { Logger } from "../logger/index.js";

const log = new Logger("acp:events");

// ── Tool progress callback ──────────────────────────────────────────────────

export function makeToolProgressCb(
  conn: acp.AgentSideConnection,
  sessionId: string,
  toolCallIds: Map<string, string[]>,
  toolCallMeta: Map<string, Record<string, any>>,
): (eventType: string, name: string, preview: string, args: any) => void {
  return (eventType: string, name: string, _preview?: string, args?: any) => {
    if (eventType !== "tool.started") return;

    if (typeof args === "string") {
      try { args = JSON.parse(args); } catch { args = { raw: args }; }
    }
    if (!args || typeof args !== "object") args = {};

    const tcId = makeToolCallId();
    let queue = toolCallIds.get(name);
    if (!queue) { queue = []; toolCallIds.set(name, queue); }
    queue.push(tcId);

    toolCallMeta.set(tcId, { args });

    const update = buildToolStart(tcId, name, args);
    conn.sessionUpdate({ sessionId, update }).catch(() => {});
  };
}

// ── Thinking callback ──────────────────────────────────────────────────────

export function makeThinkingCb(
  conn: acp.AgentSideConnection,
  sessionId: string,
): (text: string) => void {
  return (text: string) => {
    if (!text) return;
    conn.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text },
      },
    }).catch(() => {});
  };
}

// ── Step callback ──────────────────────────────────────────────────────────

export function makeStepCb(
  conn: acp.AgentSideConnection,
  sessionId: string,
  toolCallIds: Map<string, string[]>,
  toolCallMeta: Map<string, Record<string, any>>,
): (apiCallCount: number, prevTools: any[]) => void {
  return (_apiCallCount: number, prevTools?: any[]) => {
    if (!prevTools || !Array.isArray(prevTools)) return;

    for (const toolInfo of prevTools) {
      let toolName: string | undefined;
      let result: string | undefined;
      let functionArgs: Record<string, any> | undefined;

      if (typeof toolInfo === "object" && toolInfo !== null) {
        toolName = toolInfo.name || toolInfo.function_name;
        result = toolInfo.result || toolInfo.output;
        functionArgs = toolInfo.arguments || toolInfo.args;
      } else if (typeof toolInfo === "string") {
        toolName = toolInfo;
      }

      if (!toolName) continue;
      const queue = toolCallIds.get(toolName);
      if (!queue || queue.length === 0) continue;

      const tcId = queue.shift()!;
      const meta = toolCallMeta.get(tcId) ?? {};
      const update = buildToolComplete(tcId, toolName, result ?? undefined, functionArgs ?? meta.args);
      conn.sessionUpdate({ sessionId, update }).catch(() => {});
    }
  };
}

// ── Message callback ───────────────────────────────────────────────────────

export function makeMessageCb(
  conn: acp.AgentSideConnection,
  sessionId: string,
): (text: string) => void {
  return (text: string) => {
    if (!text) return;
    conn.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    }).catch(() => {});
  };
}
