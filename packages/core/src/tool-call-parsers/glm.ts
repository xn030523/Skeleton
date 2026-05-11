import { randomUUID } from "node:crypto";
import type { ParseResult } from "./base.js";
import { registerParser } from "./base.js";

const START = "<tool_call>";
const END = "</tool_call>";
const ARG_KEY_OPEN = "<arg_key>";
const ARG_KEY_CLOSE = "</arg_key>";
const ARG_VAL_OPEN = "<arg_value>";
const ARG_VAL_CLOSE = "</arg_value>";

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function deserializeValue(v: string): unknown {
  try { return JSON.parse(v); } catch { /* next */ }
  return v;
}

export class GlmParser {
  protected funcCallRe: RegExp;
  protected funcDetailRe: RegExp;
  protected funcArgRe: RegExp;

  constructor() {
    this.funcCallRe = new RegExp(escapeRe(START) + ".*?" + escapeRe(END), "gs");
    this.funcDetailRe = new RegExp(
      escapeRe(START) + "([^\\n]*)\\n(.*)" + escapeRe(END), "s",
    );
    this.funcArgRe = new RegExp(
      escapeRe(ARG_KEY_OPEN) + "(.*?)" + escapeRe(ARG_KEY_CLOSE) +
      "\\s*" + escapeRe(ARG_VAL_OPEN) + "(.*?)" + escapeRe(ARG_VAL_CLOSE), "gs",
    );
  }

  parse(text: string): ParseResult {
    if (!text.includes(START)) return { content: text, toolCalls: null };

    try {
      const callBlocks = [...text.matchAll(this.funcCallRe)].map(m => m[0]);
      if (callBlocks.length === 0) return { content: text, toolCalls: null };

      const toolCalls: { name: string; arguments: string; id: string }[] = [];

      for (const block of callBlocks) {
        this.funcDetailRe.lastIndex = 0;
        const detail = this.funcDetailRe.exec(block);
        if (!detail) continue;

        const funcName = detail[1].trim();
        const argsRaw = detail[2];

        const argDict: Record<string, unknown> = {};
        if (argsRaw) {
          const pairs = [...argsRaw.matchAll(this.funcArgRe)];
          for (const p of pairs) {
            const key = p[1].trim();
            const val = deserializeValue(p[2].trim());
            argDict[key] = val;
          }
        }

        toolCalls.push({
          name: funcName,
          arguments: JSON.stringify(argDict),
          id: `call_${randomUUID().slice(0, 8)}`,
        });
      }

      if (toolCalls.length === 0) return { content: text, toolCalls: null };

      const firstIdx = text.indexOf(START);
      const content = text.slice(0, firstIdx).trim();
      return { content: content || null, toolCalls };
    } catch {
      return { content: text, toolCalls: null };
    }
  }
}

export class Glm47Parser extends GlmParser {
  constructor() {
    super();
    this.funcDetailRe = new RegExp(
      escapeRe(START) + "(.*?)(" + escapeRe(ARG_KEY_OPEN) + ".*)?" + escapeRe(END), "s",
    );
    this.funcArgRe = new RegExp(
      escapeRe(ARG_KEY_OPEN) + "(.*?)" + escapeRe(ARG_KEY_CLOSE) +
      "(?:\\\\n|\\s)*" + escapeRe(ARG_VAL_OPEN) + "(.*?)" + escapeRe(ARG_VAL_CLOSE), "gs",
    );
  }
}

registerParser("glm45", GlmParser);
registerParser("glm47", Glm47Parser);
