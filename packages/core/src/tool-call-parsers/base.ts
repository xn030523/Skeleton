/**
 * Base types for tool-call parsers.
 *
 * Kept in a standalone file to break the circular import between
 * `./index.ts` (barrel + side-effect registrations) and each parser
 * subclass. Bundlers (rolldown) otherwise hoist the barrel such that
 * subclasses see `ToolCallParser` as `undefined` at class-init time.
 */

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

const PARSER_REGISTRY: Map<string, new () => ToolCallParser> = new Map();

export function registerParser(name: string, cls: new () => ToolCallParser): void {
  PARSER_REGISTRY.set(name, cls);
}

export function getParser(name: string): ToolCallParser {
  const cls = PARSER_REGISTRY.get(name);
  if (!cls) {
    throw new Error(`Tool call parser '${name}' not found. Available: ${listParsers().join(", ")}`);
  }
  return new cls();
}

export function listParsers(): string[] {
  return [...PARSER_REGISTRY.keys()].sort();
}

export function hasParser(name: string): boolean {
  return PARSER_REGISTRY.has(name);
}
