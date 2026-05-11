// Re-export base types + registry from the standalone base module.
// The base is kept separate so parser subclasses don't form a circular
// import against this barrel file (see ./base.ts for the rationale).
export {
  ToolCallParser,
  registerParser,
  getParser,
  listParsers,
  hasParser,
} from "./base.js";
export type { ParseResult, ToolCallResult } from "./base.js";

// Side-effect imports: each subclass registers itself via registerParser().
import "./nous.js";
import "./mistral.js";
import "./qwen.js";
import "./deepseek-v3.js";
import "./deepseek-v31.js";
import "./llama.js";
import "./glm.js";
import "./kimi-k2.js";
import "./longcat.js";
import "./qwen3-coder.js";

// Re-export parser classes for external use.
export { HermesParser } from "./nous.js";
export { MistralParser } from "./mistral.js";
export { QwenParser } from "./qwen.js";
export { DeepSeekV3Parser } from "./deepseek-v3.js";
export { DeepSeekV31Parser } from "./deepseek-v31.js";
export { LlamaParser } from "./llama.js";
export { GlmParser, Glm47Parser } from "./glm.js";
export { KimiK2Parser } from "./kimi-k2.js";
export { LongCatParser } from "./longcat.js";
export { Qwen3CoderParser } from "./qwen3-coder.js";
