import { randomUUID } from "node:crypto";
import type { ParseResult } from "./index.js";
import { registerParser } from "./index.js";
import { MistralParser } from "./mistral.js";

export class KimiK2Parser {
  parse(text: string): ParseResult {
    if (!text.includes("[TOOL_CALLS]") && !text.includes(".functions.")) {
      return { content: text, toolCalls: null };
    }

    try {
      const mistral = new MistralParser().parse(text);
      if (mistral.toolCalls && mistral.toolCalls.length > 0) return mistral;

      const re = /\.functions\.(\w+)\(([\s\S]*?)\)/g;
      const toolCalls: { name: string; arguments: string; id: string }[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        const name = m[1];
        let args = m[2].trim();
        try { const p = JSON.parse(args); args = JSON.stringify(p); } catch { /* keep raw */ }
        toolCalls.push({ name, arguments: args, id: `call_${randomUUID().slice(0, 8)}` });
      }

      if (toolCalls.length === 0) return { content: text, toolCalls: null };
      const firstIdx = text.search(/(\[TOOL_CALLS\]|\.functions\.)/);
      const content = firstIdx > 0 ? text.slice(0, firstIdx).trim() : null;
      return { content, toolCalls };
    } catch {
      return { content: text, toolCalls: null };
    }
  }
}

registerParser("kimi_k2", KimiK2Parser);
