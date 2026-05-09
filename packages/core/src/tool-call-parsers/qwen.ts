import { HermesParser } from "./hermes.js";
import { registerParser } from "./index.js";

export class QwenParser extends HermesParser {}

registerParser("qwen", QwenParser);
