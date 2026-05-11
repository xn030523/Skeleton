/**
 * ACP tool-call helpers — map Skeleton tools to ACP ToolKind and build content.
 *
 * Aligned with Hermes acp_adapter/tools.py.
 */

import crypto from "node:crypto";
import type * as schema from "@agentclientprotocol/sdk";

// ── Tool Kind Map ────────────────────────────────────────────────────────────

const TOOL_KIND_MAP: Record<string, schema.ToolKind> = {
  // File operations
  read_file: "read",
  write_file: "edit",
  patch: "edit",
  search_files: "search",
  // Terminal / execution
  terminal: "execute",
  execute_code: "execute",
  // Session/meta
  todo: "other",
  skill_view: "read",
  skill_manage: "edit",
  // Web / fetch
  web_search: "fetch",
  web_extract: "fetch",
  // Browser
  browser_navigate: "fetch",
  browser_click: "execute",
  browser_type: "execute",
  browser_snapshot: "read",
  // Agent internals
  delegate_task: "execute",
  vision_analyze: "read",
  image_generate: "execute",
  text_to_speech: "execute",
  // Thinking
  _thinking: "think",
};

export function getToolKind(toolName: string): schema.ToolKind {
  return TOOL_KIND_MAP[toolName] ?? "other";
}

export function makeToolCallId(): string {
  return `tc-${crypto.randomUUID().slice(0, 12)}`;
}

// ── Tool Title ─────────────────────────────────────────────────────────────

export function buildToolTitle(toolName: string, args: Record<string, any>): string {
  if (toolName === "terminal") {
    const cmd = args.command ?? "";
    return `terminal: ${cmd.slice(0, 80)}${cmd.length > 80 ? "..." : ""}`;
  }
  if (toolName === "read_file") return `read: ${args.path ?? "?"}`;
  if (toolName === "write_file") return `write: ${args.path ?? "?"}`;
  if (toolName === "patch") return `patch (${args.mode ?? "replace"}): ${args.path ?? "?"}`;
  if (toolName === "search_files") return `search: ${args.pattern ?? "?"}`;
  if (toolName === "web_search") return `web search: ${args.query ?? "?"}`;
  if (toolName === "web_extract") return `web extract: ${(args.urls ?? [])[0] ?? "?"}`;
  if (toolName === "execute_code") return "python code";
  if (toolName === "delegate_task") return "delegate task";
  if (toolName === "session_search") return `session search: ${args.query ?? "?"}`;
  if (toolName === "memory") return `memory ${args.action ?? "manage"}`;
  if (toolName === "todo") return "todo";
  if (toolName === "skill_view") return `skill view (${args.name ?? "?"})`;
  if (toolName === "skill_manage") return `skill ${args.action ?? "manage"}: ${args.name ?? "?"}`;
  return toolName;
}

// ── Location Extraction ─────────────────────────────────────────────────────

export function extractLocations(args: Record<string, any>): schema.ToolCallLocation[] {
  const locations: schema.ToolCallLocation[] = [];
  const p = args.path;
  if (p) {
    locations.push({ path: p, line: args.offset ?? args.line });
  }
  return locations;
}

// ── Build Tool Start ───────────────────────────────────────────────────────

export function buildToolStart(
  toolCallId: string,
  toolName: string,
  args: Record<string, any>,
): schema.SessionUpdate {
  const kind = getToolKind(toolName);
  const title = buildToolTitle(toolName, args);
  const locations = extractLocations(args);

  let content: schema.ToolCallContent[] | undefined;

  if (toolName === "write_file") {
    content = [{ type: "diff", path: args.path ?? "", content: args.content ?? "" }].filter(Boolean) as any;
  } else if (toolName === "terminal") {
    content = [{ type: "content", content: { type: "text", text: `$ ${args.command ?? ""}` } }] as any;
  } else if (toolName === "web_search") {
    content = [{ type: "content", content: { type: "text", text: `Searching the web for: ${args.query ?? ""}` } }] as any;
  } else if (toolName === "search_files") {
    content = [{ type: "content", content: { type: "text", text: `Searching for '${args.pattern ?? ""}'` } }] as any;
  }

  return {
    sessionUpdate: "tool_call",
    toolCallId,
    title,
    kind,
    status: "pending",
    locations: locations.length > 0 ? locations : undefined,
    content,
    rawInput: args,
  } as schema.SessionUpdate;
}

// ── Build Tool Complete ─────────────────────────────────────────────────────

export function buildToolComplete(
  toolCallId: string,
  toolName: string,
  result?: string,
  functionArgs?: Record<string, any>,
): schema.SessionUpdate {
  const kind = getToolKind(toolName);
  const displayResult = result ?? "";
  const truncated = displayResult.length > 5000
    ? displayResult.slice(0, 4900) + `\n... (${displayResult.length} chars total, truncated)`
    : displayResult;

  let content: schema.ToolCallContent[] | undefined;
  if (truncated) {
    content = [{ type: "content", content: { type: "text", text: truncated } }] as any;
  }

  return {
    sessionUpdate: "tool_call_update",
    toolCallId,
    kind,
    status: "completed",
    content,
    rawOutput: truncated || undefined,
  } as schema.SessionUpdate;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function _truncateText(text: string, limit = 5000): string {
  if (text.length <= limit) return text;
  return text.slice(0, limit - 100) + `\n... (${text.length} chars total, truncated)`;
}
