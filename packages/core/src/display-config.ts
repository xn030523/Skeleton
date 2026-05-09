/**
 * Display Config — platform-aware display settings for terminal,
 * Telegram, Discord, and web output targets.
 */

export type DisplayPlatform = "terminal" | "telegram" | "discord" | "web";

export interface DisplayConfig {
  markdownLevel: "none" | "basic" | "full";
  codeHighlight: boolean;
  imageHandling: "inline" | "link" | "omit";
  maxWidth: number;
  emojiSupport: boolean;
  escapeMarkdown: boolean;
  chunkMessages: boolean;
  maxChunkSize: number;
}

export const DEFAULT_DISPLAY_CONFIGS: Record<DisplayPlatform, DisplayConfig> = {
  terminal: {
    markdownLevel: "full",
    codeHighlight: true,
    imageHandling: "link",
    maxWidth: 120,
    emojiSupport: true,
    escapeMarkdown: false,
    chunkMessages: false,
    maxChunkSize: Infinity,
  },
  telegram: {
    markdownLevel: "basic",
    codeHighlight: false,
    imageHandling: "inline",
    maxWidth: 4096,
    emojiSupport: true,
    escapeMarkdown: true,
    chunkMessages: true,
    maxChunkSize: 4096,
  },
  discord: {
    markdownLevel: "basic",
    codeHighlight: false,
    imageHandling: "link",
    maxWidth: 2000,
    emojiSupport: true,
    escapeMarkdown: false,
    chunkMessages: true,
    maxChunkSize: 2000,
  },
  web: {
    markdownLevel: "full",
    codeHighlight: true,
    imageHandling: "inline",
    maxWidth: Infinity,
    emojiSupport: true,
    escapeMarkdown: false,
    chunkMessages: false,
    maxChunkSize: Infinity,
  },
};

/** Resolve display config for a platform, with optional overrides */
export function resolveDisplayConfig(
  platform: DisplayPlatform,
  overrides?: Partial<DisplayConfig>,
): DisplayConfig {
  const base = DEFAULT_DISPLAY_CONFIGS[platform];
  if (!overrides) return { ...base };
  return { ...base, ...overrides };
}
