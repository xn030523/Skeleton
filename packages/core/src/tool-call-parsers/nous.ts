import { randomUUID } from "node:crypto";
import type { ParseResult } from "./base.js";
import { registerParser } from "./base.js";

const TC_OPEN = "\u{1F3C3}";
const TC_CLOSE = "\u{1F3C4}";

// Hermes tool call format markers
const MARKER_OPEN = "<tool_call>";
const MARKER_CLOSE = "</tool_call>";

export class HermesParser {
  parse(text: string): ParseResult {
    if (!text.includes(MARKER_OPEN)) return { content: text, toolCalls: null };

    try {
      const openRe = new RegExp(
        escapeRe(MARKER_OPEN) + "\\s*([\\s\\S]*?)\\s*" + escapeRe(MARKER_CLOSE),
        "g",
      );

      const toolCalls: { name: string; arguments: string; id: string }[] = [];
      let m: RegExpExecArray | null;

      while ((m = openRe.exec(text)) !== null) {
        const raw = m[1].trim();
        if (!raw) continue;
        try {
          const data = JSON.parse(raw);
          if (data.name) {
            toolCalls.push({
              name: String(data.name),
              arguments: typeof data.arguments === "string"
                ? data.arguments
                : JSON.stringify(data.arguments ?? {}),
              id: `call_${randomUUID().slice(0, 8)}`,
            });
          }
        } catch { continue; }
      }

      if (toolCalls.length === 0) return { content: text, toolCalls: null };

      const firstIdx = text.indexOf(MARKER_OPEN);
      const content = text.slice(0, firstIdx).trim();
      return { content: content || null, toolCalls };
    } catch {
      return { content: text, toolCalls: null };
    }
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

registerParser("hermes", HermesParser);
