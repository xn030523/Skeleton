export interface ToolCallResult {
  name: string;
  arguments: string;
  id: string;
}

export interface ParseResult {
  content: string | null;
  toolCalls: ToolCallResult[] | null;
}

export abstract class ToolCallParser {
  abstract parse(text: string): ParseResult;
}

let PARSER_REGISTRY: Map<string, new () => ToolCallParser> | undefined;

function ensureRegistry(): Map<string, new () => ToolCallParser> {
  if (!PARSER_REGISTRY) PARSER_REGISTRY = new Map();
  return PARSER_REGISTRY;
}

export function registerParser(name: string, cls: new () => ToolCallParser): void {
  ensureRegistry().set(name, cls);
}

export function getParser(name: string): ToolCallParser {
  const cls = ensureRegistry().get(name);
  if (!cls) {
    throw new Error(`Tool call parser '${name}' not found. Available: ${listParsers().join(", ")}`);
  }
  return new cls();
}

export function listParsers(): string[] {
  return [...ensureRegistry().keys()].sort();
}

export function hasParser(name: string): boolean {
  return ensureRegistry().has(name);
}

// Import parsers to trigger registration (side-effect imports)
import "./hermes.js";
import "./mistral.js";
import "./qwen.js";
import "./deepseek-v3.js";
import "./deepseek-v31.js";
import "./llama.js";
import "./glm.js";
import "./kimi-k2.js";

// Re-export parser classes for external use
export { HermesParser } from "./hermes.js";
export { MistralParser } from "./mistral.js";
export { QwenParser } from "./qwen.js";
export { DeepSeekV3Parser } from "./deepseek-v3.js";
export { DeepSeekV31Parser } from "./deepseek-v31.js";
export { LlamaParser } from "./llama.js";
export { GlmParser, Glm47Parser } from "./glm.js";
export { KimiK2Parser } from "./kimi-k2.js";
