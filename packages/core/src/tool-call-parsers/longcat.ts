/**
 * LongCat parser — Meituan LongCat model tool-call format.
 *
 * LongCat emits tool calls as:
 *   <tool_call>
 *   {"name": "...", "arguments": {...}}
 *   </tool_call>
 *
 * Same wrapper as Hermes but with slightly different extraction edge cases.
 */

import { ToolCallParser, registerParser, type ParseResult, type ToolCallResult } from "./base.js";

const TOOL_CALL_RE = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;

export class LongCatParser extends ToolCallParser {
  parse(text: string): ParseResult {
    const toolCalls: ToolCallResult[] = [];
    let content = text;
    let match;
    let idx = 0;

    const matches: Array<{ full: string; inner: string }> = [];
    while ((match = TOOL_CALL_RE.exec(text)) !== null) {
      matches.push({ full: match[0], inner: match[1] });
    }

    for (const m of matches) {
      try {
        const parsed = JSON.parse(m.inner);
        if (parsed && typeof parsed === "object" && parsed.name) {
          toolCalls.push({
            id: `longcat_${Date.now().toString(36)}_${idx++}`,
            name: String(parsed.name),
            arguments: JSON.stringify(parsed.arguments ?? {}),
          });
          content = content.replace(m.full, "");
        }
      } catch { /* skip malformed */ }
    }

    return {
      content: content.trim() || null,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
    };
  }
}

registerParser("longcat", LongCatParser);
