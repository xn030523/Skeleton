/**
 * Slash Command Registry — Central definition of all CLI slash commands.
 *
 * Single source of truth for:
 * - Command names, descriptions, and aliases
 * - Categorization (Session / Configuration / Tools / Info / Exit)
 * - Argument hints and subcommands (for /help display)
 * - Tab completion data
 *
 * To add a new command: append a CommandDef to COMMAND_REGISTRY below.
 * To add an alias: set `aliases: ["short"]` on the existing CommandDef.
 */

export type CommandCategory =
  | "Session"
  | "Configuration"
  | "Memory"
  | "Tools"
  | "Info"
  | "Exit";

export interface CommandDef {
  /** Canonical name without the leading slash (e.g., "new", "goal") */
  name: string;
  /** Human-readable description shown in /help */
  description: string;
  /** Category grouping for /help display */
  category: CommandCategory;
  /** Alternative names (e.g., "reset" → "new") */
  aliases?: string[];
  /** Argument placeholder shown in /help (e.g., "<text>", "[name]") */
  argsHint?: string;
  /** Tab-completable subcommands (e.g., goal status|pause|resume|clear) */
  subcommands?: string[];
}

export const COMMAND_REGISTRY: CommandDef[] = [
  // ── Session ────────────────────────────────────────────────────────
  {
    name: "new",
    description: "Start a new session (conversation reset, memories kept)",
    category: "Session",
  },
  {
    name: "reset",
    description: "Reset conversation history",
    category: "Session",
  },
  {
    name: "history",
    description: "Show conversation history",
    category: "Session",
  },
  {
    name: "undo",
    description: "Remove the last user/assistant exchange",
    category: "Session",
  },
  {
    name: "compress",
    description: "Manually compress conversation context",
    category: "Session",
  },
  {
    name: "branch",
    description: "Create a named branch from the current conversation point",
    category: "Session",
    argsHint: "<name>",
  },
  {
    name: "resume",
    description: "Resume a previously branched session",
    category: "Session",
    argsHint: "<name>",
  },
  {
    name: "snapshot",
    description: "Create, restore, list, or prune state snapshots",
    category: "Session",
    argsHint: "[create|restore|list|prune]",
    subcommands: ["create", "restore", "list", "prune"],
  },
  {
    name: "goal",
    description: "Set/manage a standing goal (autonomous multi-turn work)",
    category: "Session",
    argsHint: "[text | status | pause | resume | clear]",
    subcommands: ["status", "pause", "resume", "clear"],
  },

  // ── Configuration ──────────────────────────────────────────────────
  {
    name: "model",
    description: "Show current model and provider",
    category: "Configuration",
  },
  {
    name: "verbose",
    description: "Cycle tool output mode: off → new → all → verbose",
    category: "Configuration",
    argsHint: "[off|new|all|verbose]",
    subcommands: ["off", "new", "all", "verbose"],
  },
  {
    name: "personality",
    description: "Show or set the AI personality (SOUL.md)",
    category: "Configuration",
    argsHint: "[name]",
  },
  {
    name: "skin",
    description: "Show or switch the UI skin/theme",
    category: "Configuration",
    argsHint: "[name]",
  },
  {
    name: "statusbar",
    description: "Cycle status bar mode: compact → normal → detailed",
    category: "Configuration",
    argsHint: "[compact|normal|detailed]",
    subcommands: ["compact", "normal", "detailed"],
  },

  // ── Memory ──────────────────────────────────────────────────────────
  {
    name: "memory",
    description: "Show saved memories",
    category: "Memory",
  },
  {
    name: "remember",
    description: "Save a note to memory",
    category: "Memory",
    argsHint: "<text>",
  },
  {
    name: "forget",
    description: "Delete memories matching a keyword",
    category: "Memory",
    argsHint: "<keyword>",
  },
  {
    name: "search",
    description: "Search past conversations",
    category: "Memory",
    argsHint: "<query>",
  },
  {
    name: "profile",
    description: "Show the stored user profile",
    category: "Memory",
  },

  // ── Tools ──────────────────────────────────────────────────────────
  {
    name: "tools",
    description: "List registered tools",
    category: "Tools",
  },
  {
    name: "mcp",
    description: "List built-in MCP servers and how to enable them",
    category: "Tools",
  },
  {
    name: "curator",
    description: "Run skill maintenance (dedup, categorize, detect stale)",
    category: "Tools",
  },
  {
    name: "plugin",
    description: "Manage plugins (list, load, unload, reload)",
    category: "Tools",
    argsHint: "[list|load|unload|reload]",
    subcommands: ["list", "load", "unload", "reload"],
  },

  // ── Info ───────────────────────────────────────────────────────────
  {
    name: "help",
    description: "Show all available commands grouped by category",
    category: "Info",
    aliases: ["?"],
  },
  {
    name: "usage",
    description: "Show token usage and context window stats",
    category: "Info",
  },
  {
    name: "insights",
    description: "Show usage insights and activity trends",
    category: "Info",
    argsHint: "[days]",
  },
  {
    name: "onboarding",
    description: "Run the first-run setup wizard",
    category: "Configuration",
  },
  {
    name: "lang",
    description: "Show or switch the UI language",
    category: "Configuration",
    argsHint: "[en|zh|ja|ko|de|es|fr|tr|uk]",
  },
  {
    name: "copy",
    description: "Copy last assistant output to system clipboard",
    category: "Session",
  },
  {
    name: "paste",
    description: "Paste from system clipboard and submit as input",
    category: "Session",
  },
  {
    name: "voice",
    description: "Toggle voice mode (TTS output + STT input)",
    category: "Configuration",
    argsHint: "[on|off|tts|stt]",
    subcommands: ["on", "off", "tts", "stt"],
  },
  {
    name: "sessions",
    description: "Browse and search past sessions",
    category: "Memory",
    argsHint: "[list|search <query>]",
    subcommands: ["list", "search"],
  },
  {
    name: "update",
    description: "Check for and apply Skeleton updates",
    category: "Configuration",
  },
  {
    name: "debug",
    description: "Generate a diagnostic report for troubleshooting",
    category: "Info",
  },
  {
    name: "clear",
    description: "Clear the terminal screen",
    category: "Session",
  },
  {
    name: "redraw",
    description: "Redraw the terminal screen",
    category: "Session",
  },
  {
    name: "bg",
    description: "Manage background tasks (list/kill/status)",
    category: "Session",
    argsHint: "[list|kill <id>|status]",
    subcommands: ["list", "kill", "status"],
  },
  {
    name: "status",
    description: "Show current agent runtime status",
    category: "Info",
  },
  {
    name: "security",
    description: "Scan packages for known vulnerabilities (OSV)",
    category: "Tools",
    argsHint: "[check <package>]",
  },
  {
    name: "honcho",
    description: "View dialectical user model (hypotheses about preferences)",
    category: "Memory",
    argsHint: "[list|reconcile|observe <claim>]",
  },
  {
    name: "cron",
    description: "Manage scheduled tasks",
    category: "Session",
    argsHint: "[list|add|remove|enable|disable]",
    subcommands: ["list", "add", "remove", "enable", "disable"],
  },
  {
    name: "trajectory",
    description: "Compress current conversation trajectory for training",
    category: "Session",
  },

  // ── Exit ───────────────────────────────────────────────────────────
  {
    name: "quit",
    description: "Exit the CLI",
    category: "Exit",
    aliases: ["exit"],
  },
];

// ── Derived lookups (built once at import time) ──────────────────────

const LOOKUP: Map<string, CommandDef> = new Map();
for (const cmd of COMMAND_REGISTRY) {
  LOOKUP.set(cmd.name, cmd);
  for (const alias of cmd.aliases ?? []) {
    LOOKUP.set(alias, cmd);
  }
}

/** Resolve a name or alias (with/without leading slash) to its CommandDef */
export function resolveCommand(name: string): CommandDef | null {
  const clean = name.trim().toLowerCase().replace(/^\//, "");
  return LOOKUP.get(clean) ?? null;
}

/** Return all distinct command names and aliases, sorted (for Tab completion) */
export function listAllCommandNames(): string[] {
  const names = new Set<string>();
  for (const cmd of COMMAND_REGISTRY) {
    names.add(cmd.name);
    for (const alias of cmd.aliases ?? []) {
      names.add(alias);
    }
  }
  return [...names].sort();
}

/** Return commands grouped by category (for /help display) */
export function commandsByCategory(): Record<CommandCategory, CommandDef[]> {
  const groups = {
    Session: [] as CommandDef[],
    Configuration: [] as CommandDef[],
    Memory: [] as CommandDef[],
    Tools: [] as CommandDef[],
    Info: [] as CommandDef[],
    Exit: [] as CommandDef[],
  };
  for (const cmd of COMMAND_REGISTRY) {
    groups[cmd.category].push(cmd);
  }
  return groups;
}

/** Build a one-line description with usage hint (for /help) */
export function commandHelpLine(cmd: CommandDef): string {
  const aliasPart = cmd.aliases && cmd.aliases.length > 0
    ? ` (${cmd.aliases.map(a => "/" + a).join(", ")})`
    : "";
  const argsPart = cmd.argsHint ? ` ${cmd.argsHint}` : "";
  return `/${cmd.name}${argsPart}${aliasPart} — ${cmd.description}`;
}

/** Get all subcommands for a given command (used for Tab completion) */
export function getSubcommands(name: string): string[] {
  const cmd = resolveCommand(name);
  return cmd?.subcommands ?? [];
}
