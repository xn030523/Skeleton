/**
 * Qwen3 Coder parser — Alibaba Qwen3-Coder specific format.
 *
 * Qwen3-Coder uses XML-ish function calls:
 *   <function_calls>
 *   <invoke name="toolname">
 *   <parameter name="key">value</parameter>
 *   </invoke>
 *   </function_calls>
 *
 * This differs from the plain Hermes/Qwen format.
 */

import { ToolCallParser, registerParser, type ParseResult, type ToolCallResult } from "./base.js";

const FUNC_CALLS_RE = /<function_calls>([\s\S]*?)<\/function_calls>/g;
const INVOKE_RE = /<invoke\s+name="([^"]+)">([\s\S]*?)<\/invoke>/g;
const PARAM_RE = /<parameter\s+name="([^"]+)">([\s\S]*?)<\/parameter>/g;

export class Qwen3CoderParser extends ToolCallParser {
  parse(text: string): ParseResult {
    const toolCalls: ToolCallResult[] = [];
    let content = text;
    let idx = 0;

    const blocks: Array<{ full: string; inner: string }> = [];
    let fcMatch;
    while ((fcMatch = FUNC_CALLS_RE.exec(text)) !== null) {
      blocks.push({ full: fcMatch[0], inner: fcMatch[1] });
    }

    for (const block of blocks) {
      let invokeMatch;
      INVOKE_RE.lastIndex = 0;
      while ((invokeMatch = INVOKE_RE.exec(block.inner)) !== null) {
        const name = invokeMatch[1];
        const body = invokeMatch[2];
        const args: Record<string, string> = {};

        let paramMatch;
        PARAM_RE.lastIndex = 0;
        while ((paramMatch = PARAM_RE.exec(body)) !== null) {
          args[paramMatch[1]] = paramMatch[2].trim();
        }

        // Try to coerce numeric / boolean / JSON values
        const coerced: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(args)) {
          if (v === "true") coerced[k] = true;
          else if (v === "false") coerced[k] = false;
          else if (/^-?\d+$/.test(v)) coerced[k] = parseInt(v, 10);
          else if (/^-?\d+\.\d+$/.test(v)) coerced[k] = parseFloat(v);
          else if ((v.startsWith("{") && v.endsWith("}")) || (v.startsWith("[") && v.endsWith("]"))) {
            try { coerced[k] = JSON.parse(v); } catch { coerced[k] = v; }
          } else {
            coerced[k] = v;
          }
        }

        toolCalls.push({
          id: `qwen3coder_${Date.now().toString(36)}_${idx++}`,
          name,
          arguments: JSON.stringify(coerced),
        });
      }
      content = content.replace(block.full, "");
    }

    return {
      content: content.trim() || null,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
    };
  }
}

registerParser("qwen3-coder", Qwen3CoderParser);
registerParser("qwen3_coder", Qwen3CoderParser); // alias
