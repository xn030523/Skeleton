/**
 * Pretty Tool Output — Hermes-style formatted tool call display.
 *
 * Format: `┊ {emoji} {verb:9} {detail}  {duration}`
 *
 * Example output:
 *   ┊ 🔍 search    "python async patterns"           0.8s
 *   ┊ 📖 read      src/agent.ts                       0.1s
 *   ┊ ✍️  write     src/new-feature.ts                 0.2s
 *   ┊ 💻 $         npm install react                  3.5s
 *   ┊ 🌐 navigate  github.com                         1.2s
 *
 * Inspired by Hermes's get_cute_tool_message().
 */

import chalk from "chalk";

const TOOL_PREFIX = "┊";
const DEFAULT_MAX_DETAIL_LEN = 42;

/** Tool emoji map — lookup by tool name */
const TOOL_EMOJIS: Record<string, string> = {
  // Search & read
  web_search: "🔍",
  web_extract: "📄",
  web_crawl: "🕸️",
  search_files: "🔎",
  read_file: "📖",
  grep: "🔎",
  glob: "📂",

  // Write & edit
  write_file: "✍️",
  patch: "🔧",
  edit: "✏️",
  fuzzy_edit: "🪄",

  // Execute
  terminal: "💻",
  bash: "💻",
  execute_code: "⚡",
  process: "⚙️",

  // Browser
  browser_navigate: "🌐",
  browser_snapshot: "📸",
  browser_click: "👆",
  browser_type: "⌨️",
  browser_scroll: "📜",
  browser_back: "◀️",
  browser_press: "⌨️",
  browser_vision: "👁️",
  browser_get_images: "🖼️",

  // Task & planning
  todo: "📋",
  todo_tool: "📋",
  plan: "📋",
  clarify: "❓",

  // Memory
  memory: "🧠",
  save_memory: "💾",
  search_memory: "🔎",
  get_user_profile: "👤",
  session_search: "🔍",
  consolidate_memories: "🧹",

  // Skills
  skill_manage: "🛠️",
  skill_view: "👁️",
  skills_list: "📚",

  // Vision & AI
  vision_analyze: "👁️",
  image_generate: "🎨",
  text_to_speech: "🔊",

  // MCP & tools
  mcp_manage: "🔌",
  toolset_manage: "🧰",
  delegate_task: "🤝",
  mixture_of_agents: "👥",
  cronjob: "⏰",
  cron_manage: "⏰",
};

/** Verb map — short descriptive verb for each tool */
const TOOL_VERBS: Record<string, string> = {
  web_search: "search",
  web_extract: "fetch",
  web_crawl: "crawl",
  search_files: "grep",
  read_file: "read",
  grep: "grep",
  glob: "find",

  write_file: "write",
  patch: "patch",
  edit: "edit",
  fuzzy_edit: "fuzzy",

  terminal: "$",
  bash: "$",
  execute_code: "exec",
  process: "proc",

  browser_navigate: "navigate",
  browser_snapshot: "snapshot",
  browser_click: "click",
  browser_type: "type",
  browser_scroll: "scroll",
  browser_back: "back",
  browser_press: "press",
  browser_vision: "vision",
  browser_get_images: "images",

  todo: "plan",
  todo_tool: "plan",
  plan: "plan",
  clarify: "clarify",

  memory: "memory",
  save_memory: "memory",
  search_memory: "recall",
  get_user_profile: "profile",
  session_search: "recall",
  consolidate_memories: "clean",

  skill_manage: "skill",
  skill_view: "skill",
  skills_list: "skills",

  vision_analyze: "vision",
  image_generate: "image",
  text_to_speech: "speak",

  mcp_manage: "mcp",
  toolset_manage: "tools",
  delegate_task: "delegate",
  mixture_of_agents: "moa",
  cronjob: "cron",
  cron_manage: "cron",
};

/** Collapse whitespace to single spaces */
function oneline(text: string): string {
  return text.split(/\s+/).filter(Boolean).join(" ");
}

/** Truncate text with ellipsis */
function trunc(text: string, maxLen: number = DEFAULT_MAX_DETAIL_LEN): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + "...";
}

/** Truncate path, preferring tail (filename) */
function truncPath(path: string, maxLen: number = 35): string {
  if (path.length <= maxLen) return path;
  return "..." + path.slice(-(maxLen - 3));
}

/** Extract domain from URL */
function domain(url: string): string {
  return url.replace(/^https?:\/\//, "").split("/")[0];
}

/** Get emoji for a tool, with fallback */
export function getToolEmoji(toolName: string): string {
  // Exact match
  if (TOOL_EMOJIS[toolName]) return TOOL_EMOJIS[toolName];
  // MCP tools — use a default mcp emoji
  if (toolName.startsWith("mcp_")) return "🔌";
  // Fallback
  return "⚡";
}

/** Get verb for a tool, with fallback */
export function getToolVerb(toolName: string): string {
  // Exact match
  if (TOOL_VERBS[toolName]) return TOOL_VERBS[toolName];
  // MCP tools — use the mcp function name after prefix
  if (toolName.startsWith("mcp_")) {
    const parts = toolName.split("_");
    return parts[parts.length - 1].slice(0, 9);
  }
  // Fallback — use first 9 chars of tool name
  return toolName.slice(0, 9);
}

/**
 * Build a detail string for a tool call based on its primary argument.
 * Returns a short human-readable summary.
 */
export function buildToolDetail(
  toolName: string,
  args: Record<string, unknown>,
  maxLen: number = DEFAULT_MAX_DETAIL_LEN,
): string {
  if (!args || Object.keys(args).length === 0) return "";

  // Tool-specific detail formatting (Hermes-style)
  switch (toolName) {
    case "web_search":
      return `"${trunc(oneline(String(args.query ?? "")), maxLen)}"`;

    case "web_extract": {
      const urls = args.urls;
      if (Array.isArray(urls) && urls.length > 0) {
        const d = domain(String(urls[0]));
        const extra = urls.length > 1 ? ` +${urls.length - 1}` : "";
        return trunc(d, 35) + extra;
      }
      return "pages";
    }

    case "web_crawl":
      return trunc(domain(String(args.url ?? "")), 35);

    case "terminal":
    case "bash":
      return trunc(oneline(String(args.command ?? "")), maxLen);

    case "read_file":
      return truncPath(String(args.path ?? args.file_path ?? ""));

    case "write_file":
      return truncPath(String(args.path ?? args.file_path ?? ""));

    case "patch":
    case "edit":
      return truncPath(String(args.path ?? args.file_path ?? ""));

    case "search_files":
    case "grep":
      return trunc(String(args.pattern ?? args.query ?? ""), 35);

    case "glob":
      return trunc(String(args.pattern ?? ""), 35);

    case "browser_navigate":
      return trunc(domain(String(args.url ?? "")), 35);

    case "browser_snapshot":
      return args.full ? "full" : "compact";

    case "browser_click":
      return String(args.ref ?? "?");

    case "browser_type":
      return `"${trunc(String(args.text ?? ""), 30)}"`;

    case "browser_scroll": {
      const d = String(args.direction ?? "down");
      const arrows: Record<string, string> = { down: "↓", up: "↑", right: "→", left: "←" };
      return `${arrows[d] ?? "↓"} ${d}`;
    }

    case "browser_press":
      return String(args.key ?? "?");

    case "todo":
    case "todo_tool": {
      const todos = args.todos;
      const merge = args.merge;
      if (todos == null) return "reading tasks";
      if (Array.isArray(todos)) {
        return merge ? `update ${todos.length} task(s)` : `${todos.length} task(s)`;
      }
      return "plan";
    }

    case "session_search":
    case "search_memory":
      return `"${trunc(oneline(String(args.query ?? "")), 35)}"`;

    case "memory":
    case "save_memory": {
      const action = String(args.action ?? "add");
      const target = String(args.target ?? args.category ?? "");
      const content = oneline(String(args.content ?? args.text ?? ""));
      if (action === "add") return `+${target}: "${trunc(content, 30)}"`;
      if (action === "replace") return `~${target}: "${trunc(String(args.old_text ?? ""), 20)}"`;
      if (action === "remove") return `-${target}: "${trunc(String(args.old_text ?? ""), 20)}"`;
      return action;
    }

    case "vision_analyze":
      return trunc(oneline(String(args.question ?? "")), 35);

    case "image_generate":
      return trunc(oneline(String(args.prompt ?? "")), 35);

    case "delegate_task":
      return trunc(oneline(String(args.goal ?? args.task ?? "")), 35);

    case "clarify":
      return trunc(oneline(String(args.question ?? "")), 35);

    case "skill_manage":
    case "skill_view": {
      const action = String(args.action ?? "view");
      const name = String(args.name ?? "");
      return `${action} ${name}`.trim();
    }

    case "skills_list":
      return `list ${args.category ?? "all"}`;

    case "cronjob":
    case "cron_manage":
      return String(args.action ?? "list");

    case "execute_code":
      return trunc(oneline(String(args.code ?? "")), maxLen);

    default: {
      // Fallback: try common argument keys
      const keys = ["query", "text", "command", "path", "name", "prompt", "code", "goal"];
      for (const key of keys) {
        if (args[key] != null) {
          return trunc(oneline(String(args[key])), maxLen);
        }
      }
      // MCP tools: show first string arg
      for (const val of Object.values(args)) {
        if (typeof val === "string" && val.length > 0) {
          return trunc(oneline(val), maxLen);
        }
      }
      return "";
    }
  }
}

/**
 * Format a tool call completion line (Hermes-style).
 *
 * Format: `┊ {emoji} {verb:9} {detail}  {duration}`
 *
 * @example
 *   formatToolCompletion("web_search", { query: "async patterns" }, 0.8)
 *   // => "┊ 🔍 search    "async patterns"  0.8s"
 */
export function formatToolCompletion(
  toolName: string,
  args: Record<string, unknown>,
  duration?: number,
  opts: { isError?: boolean; maxDetailLen?: number; useColor?: boolean } = {},
): string {
  const { isError = false, maxDetailLen = DEFAULT_MAX_DETAIL_LEN, useColor = true } = opts;

  const emoji = getToolEmoji(toolName);
  const verb = getToolVerb(toolName).padEnd(9);
  const detail = buildToolDetail(toolName, args, maxDetailLen);
  const dur = duration != null ? `${duration.toFixed(1)}s` : "";

  const prefix = isError ? (useColor ? chalk.red("✗") : "✗") : TOOL_PREFIX;
  const durColored = useColor ? chalk.gray(dur) : dur;
  const errSuffix = isError ? (useColor ? chalk.red(" [error]") : " [error]") : "";

  // Assemble: "┊ 🔍 search    detail  0.8s"
  const parts = [`${prefix} ${emoji} ${verb} ${detail}`];
  if (dur) parts.push(durColored);
  const line = parts.filter(Boolean).join("  ");
  return line + errSuffix;
}

/**
 * Format a tool call in-progress (for spinner text during execution).
 *
 * @example
 *   formatToolInProgress("web_search", { query: "async patterns" })
 *   // => "🔍 \"async patterns\""
 */
export function formatToolInProgress(
  toolName: string,
  args: Record<string, unknown>,
  maxDetailLen: number = DEFAULT_MAX_DETAIL_LEN,
): string {
  const emoji = getToolEmoji(toolName);
  const detail = buildToolDetail(toolName, args, maxDetailLen);
  return `${emoji} ${detail}`.trim();
}
