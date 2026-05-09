import { DeepSeekV3Parser } from "./deepseek-v3.js";
import { registerParser } from "./index.js";

export class DeepSeekV31Parser extends DeepSeekV3Parser {
  // DeepSeek V3.1 uses the same format as V3
}

registerParser("deepseek_v3_1", DeepSeekV31Parser);
