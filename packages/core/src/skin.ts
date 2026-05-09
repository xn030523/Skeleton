import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SKELETON_DIR = path.join(os.homedir(), ".skeleton");
const SKINS_DIR = path.join(SKELETON_DIR, "skins");

export interface SkinDef {
  name: string;
  description: string;
  colors: {
    primary: string;
    accent: string;
    error: string;
    success: string;
    dim: string;
    warning: string;
  };
  toolPrefix: string;
  toolEmojis: Record<string, string>;
  symbols: {
    prompt: string;
    assistant: string;
    tool: string;
    divider: string;
    bullet: string;
  };
}

const DEFAULT_SKIN: SkinDef = {
  name: "default",
  description: "Skeleton default theme",
  colors: {
    primary: "#06b6d4",
    accent: "#a855f7",
    error: "#ef4444",
    success: "#10b981",
    dim: "#64748b",
    warning: "#eab308",
  },
  toolPrefix: "┊",
  toolEmojis: {},
  symbols: {
    prompt: "❯",
    assistant: "◆",
    tool: "┊",
    divider: "─",
    bullet: "·",
  },
};

const BUILTIN_SKINS: SkinDef[] = [
  DEFAULT_SKIN,
  {
    name: "midnight",
    description: "Deep purple night theme",
    colors: {
      primary: "#7c3aed",
      accent: "#06b6d4",
      error: "#ef4444",
      success: "#10b981",
      dim: "#64748b",
      warning: "#eab308",
    },
    toolPrefix: "│",
    toolEmojis: { web_search: "🌙", read_file: "📜", write_file: "✒️", terminal: "⌨️" },
    symbols: { prompt: "◈", assistant: "◆", tool: "│", divider: "━", bullet: "◈" },
  },
  {
    name: "hacker",
    description: "Green-on-black terminal aesthetic",
    colors: {
      primary: "#00ff41",
      accent: "#39ff14",
      error: "#ff0000",
      success: "#00ff41",
      dim: "#006600",
      warning: "#ffff00",
    },
    toolPrefix: ">",
    toolEmojis: { web_search: ">>", read_file: "cat", write_file: ">>", terminal: "$" },
    symbols: { prompt: ">", assistant: "#", tool: ">", divider: "=", bullet: "*" },
  },
  {
    name: "sakura",
    description: "Soft pink cherry blossom theme",
    colors: {
      primary: "#f472b6",
      accent: "#c084fc",
      error: "#fb7185",
      success: "#34d399",
      dim: "#a8a29e",
      warning: "#fbbf24",
    },
    toolPrefix: "✿",
    toolEmojis: { web_search: "🌸", read_file: "📖", write_file: "✍️", terminal: "🎀" },
    symbols: { prompt: "✿", assistant: "❀", tool: "✿", divider: "·", bullet: "✿" },
  },
  {
    name: "ocean",
    description: "Cool blue ocean theme",
    colors: {
      primary: "#0ea5e9",
      accent: "#6366f1",
      error: "#f43f5e",
      success: "#22c55e",
      dim: "#94a3b8",
      warning: "#f59e0b",
    },
    toolPrefix: "∿",
    toolEmojis: { web_search: "🌊", read_file: "🐚", write_file: "⚓", terminal: "🐋" },
    symbols: { prompt: "∿", assistant: "◈", tool: "∿", divider: "∼", bullet: "◦" },
  },
];

export class SkinManager {
  private activeSkin: SkinDef;
  private userSkins: Map<string, SkinDef> = new Map();

  constructor() {
    this.activeSkin = DEFAULT_SKIN;
    this.loadUserSkins();
  }

  private loadUserSkins(): void {
    if (!fs.existsSync(SKINS_DIR)) return;
    for (const entry of fs.readdirSync(SKINS_DIR)) {
      if (!entry.endsWith(".yaml") && !entry.endsWith(".yml")) continue;
      try {
        const raw = fs.readFileSync(path.join(SKINS_DIR, entry), "utf-8");
        const skin = parseSkinYaml(raw);
        if (skin) this.userSkins.set(skin.name, skin);
      } catch { /* skip malformed */ }
    }
  }

  list(): SkinDef[] {
    return [...BUILTIN_SKINS, ...this.userSkins.values()];
  }

  listNames(): string[] {
    return this.list().map(s => s.name);
  }

  getActive(): SkinDef {
    return this.activeSkin;
  }

  getActiveName(): string {
    return this.activeSkin.name;
  }

  setActive(name: string): boolean {
    const skin = this.findSkin(name);
    if (!skin) return false;
    this.activeSkin = skin;
    return true;
  }

  get(name: string): SkinDef | null {
    return this.findSkin(name);
  }

  /** Get tool emoji, respecting skin overrides */
  getToolEmoji(toolName: string): string {
    const override = this.activeSkin.toolEmojis[toolName];
    if (override) return override;
    return "";
  }

  /** Get the active tool prefix character */
  getToolPrefix(): string {
    return this.activeSkin.toolPrefix;
  }

  /** Get a symbol from the active skin */
  getSymbol(key: keyof SkinDef["symbols"]): string {
    return this.activeSkin.symbols[key];
  }

  /** Get a color hex from the active skin */
  getColor(key: keyof SkinDef["colors"]): string {
    return this.activeSkin.colors[key];
  }

  private findSkin(name: string): SkinDef | null {
    const lower = name.toLowerCase();
    for (const skin of BUILTIN_SKINS) {
      if (skin.name === lower) return skin;
    }
    return this.userSkins.get(lower) ?? null;
  }
}

function parseSkinYaml(raw: string): SkinDef | null {
  // Minimal YAML parser for skin files — no dependency needed
  const lines = raw.split("\n");
  const data: Record<string, unknown> = {};
  let currentKey = "";
  let inBlock = false;
  let blockKey = "";
  const blockData: Record<string, string> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.endsWith(":") && !inBlock) {
      blockKey = trimmed.slice(0, -1).trim();
      inBlock = true;
      blockData[blockKey] = "";
      continue;
    }

    if (inBlock && !line.startsWith(" ") && !line.startsWith("\t")) {
      inBlock = false;
      if (Object.keys(blockData).length > 0) {
        data[Object.keys(blockData)[0]] = { ...blockData };
      }
    }

    if (inBlock) {
      const [key, ...rest] = trimmed.split(":");
      const val = rest.join(":").trim().replace(/^["']|["']$/g, "");
      if (key && val) {
        (data[blockKey] as Record<string, string>)[key.trim()] = val;
      }
      continue;
    }

    const [key, ...rest] = trimmed.split(":");
    const val = rest.join(":").trim().replace(/^["']|["']$/g, "");
    if (key && val) {
      data[key.trim()] = val;
    }
  }

  if (!data.name) return null;

  const colors = (data.colors as Record<string, string>) ?? {};
  const symbols = (data.symbols as Record<string, string>) ?? {};
  const emojis = (data.toolEmojis ?? data.tool_emojis ?? {}) as Record<string, string>;

  return {
    name: String(data.name),
    description: String(data.description ?? ""),
    colors: {
      primary: colors.primary ?? DEFAULT_SKIN.colors.primary,
      accent: colors.accent ?? DEFAULT_SKIN.colors.accent,
      error: colors.error ?? DEFAULT_SKIN.colors.error,
      success: colors.success ?? DEFAULT_SKIN.colors.success,
      dim: colors.dim ?? DEFAULT_SKIN.colors.dim,
      warning: colors.warning ?? DEFAULT_SKIN.colors.warning,
    },
    toolPrefix: String(data.toolPrefix ?? data.tool_prefix ?? DEFAULT_SKIN.toolPrefix),
    toolEmojis: emojis,
    symbols: {
      prompt: symbols.prompt ?? DEFAULT_SKIN.symbols.prompt,
      assistant: symbols.assistant ?? DEFAULT_SKIN.symbols.assistant,
      tool: symbols.tool ?? DEFAULT_SKIN.symbols.tool,
      divider: symbols.divider ?? DEFAULT_SKIN.symbols.divider,
      bullet: symbols.bullet ?? DEFAULT_SKIN.symbols.bullet,
    },
  };
}
