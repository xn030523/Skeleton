import { HermesParser } from "./nous.js";
import { registerParser } from "./base.js";

export class QwenParser extends HermesParser {}

registerParser("qwen", QwenParser);
