import { randomUUID } from "node:crypto";
import type { ParseResult } from "./index.js";
import { registerParser } from "./index.js";

const BOT_TOKEN = "[TOOL_CALLS]";

function genId(): string {
  const c = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let id = "";
  for (let i = 0; i < 9; i++) id += c[Math.floor(Math.random() * c.length)];
  return id;
}

export class MistralParser {
  parse(text: string): ParseResult {
    if (!text.includes(BOT_TOKEN)) return { content: text, toolCalls: null };

    try {
      const parts = text.split(BOT_TOKEN);
      const content = parts[0].trim();
      const rawParts = parts.slice(1);
      const toolCalls: { name: string; arguments: string; id: string }[] = [];
      const firstRaw = rawParts[0]?.trim() ?? "";
      const isPreV11 = firstRaw.startsWith("[") || firstRaw.startsWith("{");

      if (!isPreV11) {
        for (const raw of rawParts) {
          const r = raw.trim();
          if (!r || !r.includes("{")) continue;
          const braceIdx = r.indexOf("{");
          const toolName = r.slice(0, braceIdx).trim();
          let argsStr = r.slice(braceIdx);
          try { argsStr = JSON.stringify(JSON.parse(argsStr)); } catch { /* keep raw */ }
          toolCalls.push({ name: toolName, arguments: argsStr, id: genId() });
        }
      } else {
        try {
          const parsed = JSON.parse(firstRaw);
          const arr = Array.isArray(parsed) ? parsed : [parsed];
          for (const tc of arr) {
            if (!tc.name) continue;
            const args = typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments ?? {});
            toolCalls.push({ name: String(tc.name), arguments: args, id: genId() });
          }
        } catch {
          let idx = 0;
          while (idx < firstRaw.length) {
            const start = firstRaw.indexOf("{", idx);
            if (start === -1) break;
            try {
              const obj = JSON.parse(firstRaw.slice(start));
              if (obj.name) {
                const args = typeof obj.arguments === "string" ? obj.arguments : JSON.stringify(obj.arguments ?? {});
                toolCalls.push({ name: String(obj.name), arguments: args, id: genId() });
              }
              idx = start + 1;
            } catch { idx++; }
          }
        }
      }

      if (toolCalls.length === 0) return { content: text, toolCalls: null };
      return { content: content || null, toolCalls };
    } catch {
      return { content: text, toolCalls: null };
    }
  }
}

registerParser("mistral", MistralParser);
