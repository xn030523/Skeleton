import { randomUUID } from "node:crypto";
import type { ParseResult } from "./index.js";
import { registerParser } from "./index.js";

const BOT_TOKEN = "<|python_tag|>";

export class LlamaParser {
  parse(text: string): ParseResult {
    if (!text.includes(BOT_TOKEN) && !text.includes("{")) return { content: text, toolCalls: null };

    try {
      const toolCalls: { name: string; arguments: string; id: string }[] = [];
      let endIdx = -1;

      const braceRe = /\{/g;
      let m: RegExpExecArray | null;

      while ((m = braceRe.exec(text)) !== null) {
        const start = m.index;
        if (start <= endIdx) continue;

        try {
          const obj = tryParseJson(text.slice(start));
          if (obj === null) continue;
          endIdx = start + obj._endIdx;

          const name = obj.name;
          const args = obj.arguments ?? obj.parameters;
          if (!name || args === undefined) continue;

          const argsStr = typeof args === "string" ? args : JSON.stringify(args);
          toolCalls.push({ name: String(name), arguments: argsStr, id: `call_${randomUUID().slice(0, 8)}` });
        } catch { continue; }
      }

      if (toolCalls.length === 0) return { content: text, toolCalls: null };

      const firstIdx = text.includes(BOT_TOKEN) ? text.indexOf(BOT_TOKEN) : text.indexOf("{");
      const content = firstIdx > 0 ? text.slice(0, firstIdx).trim() : null;
      return { content, toolCalls };
    } catch {
      return { content: text, toolCalls: null };
    }
  }
}

function tryParseJson(s: string): (Record<string, unknown> & { _endIdx: number }) | null {
  // Simple depth-counting JSON parser
  let depth = 0;
  let inStr = false;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{" || c === "[") depth++;
    if (c === "}" || c === "]") {
      depth--;
      if (depth === 0) {
        try {
          const obj = JSON.parse(s.slice(0, i + 1));
          if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
            return { ...obj, _endIdx: i + 1 };
          }
        } catch { /* not valid JSON */ }
        return null;
      }
    }
  }
  return null;
}

registerParser("llama3_json", LlamaParser);
registerParser("llama4_json", LlamaParser);
