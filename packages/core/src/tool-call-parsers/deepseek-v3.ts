import { randomUUID } from "node:crypto";
import type { ParseResult } from "./index.js";
import { registerParser } from "./index.js";

const START_TOKEN = "<｜tool▁calls▁begin｜>";
const CALL_BEGIN = "<｜tool▁call▁begin｜>";
const SEP = "<｜tool▁sep｜>";
const CALL_END = "<｜tool▁call▁end｜>";

export class DeepSeekV3Parser {
  parse(text: string): ParseResult {
    if (!text.includes(START_TOKEN)) return { content: text, toolCalls: null };

    try {
      const re = new RegExp(
        escapeRe(CALL_BEGIN) + "(.*?)" + escapeRe(SEP) + "(.*?)" +
        "\\s*```(?:json)?\\s*([\\s\\S]*?)\\s*```\\s*" + escapeRe(CALL_END),
        "g",
      );

      const toolCalls: { name: string; arguments: string; id: string }[] = [];
      let m: RegExpExecArray | null;

      while ((m = re.exec(text)) !== null) {
        const funcName = (m[2] ?? "").trim();
        const funcArgs = (m[3] ?? "").trim();
        if (!funcName) continue;
        toolCalls.push({
          name: funcName,
          arguments: funcArgs,
          id: `call_${randomUUID().slice(0, 8)}`,
        });
      }

      if (toolCalls.length === 0) return { content: text, toolCalls: null };

      const firstIdx = text.indexOf(START_TOKEN);
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

registerParser("deepseek_v3", DeepSeekV3Parser);
