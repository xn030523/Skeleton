export type { Transport } from "./base.js";
export { ChatCompletionsTransport } from "./chat-completions.js";
export type { ChatCompletionsTransportOptions } from "./chat-completions.js";
export { AnthropicTransport } from "./anthropic.js";
export type { AnthropicTransportOptions } from "./anthropic.js";
export { CodexResponsesTransport } from "./codex-responses.js";
export { BedrockConverseTransport } from "./bedrock-converse.js";
export { createTransportFromConfig } from "./factory.js";

import type { LLMConfig } from "../types.js";
import type { Transport } from "./base.js";
import { ChatCompletionsTransport } from "./chat-completions.js";
import { AnthropicTransport } from "./anthropic.js";
import { CodexResponsesTransport } from "./codex-responses.js";
import { BedrockConverseTransport } from "./bedrock-converse.js";
import { findProvider } from "../providers/registry.js";
import type { ApiMode, ProviderQuirks } from "../providers/registry.js";

/** Provider-aware transport factory */
export function createTransportFromConfig(llm: LLMConfig): Transport {
  const profile = llm.provider ? findProvider(llm.provider) : null;
  const apiMode: ApiMode = profile?.apiMode ?? (llm.protocol === "anthropic" ? "anthropic_messages" : "chat_completions");
  const quirks: ProviderQuirks | undefined = profile?.quirks;

  switch (apiMode) {
    case "anthropic_messages":
      return new AnthropicTransport(llm, { quirks });
    case "codex_responses":
      return new CodexResponsesTransport(llm);
    case "bedrock_converse":
      return new BedrockConverseTransport(llm);
    case "chat_completions":
    default:
      return new ChatCompletionsTransport(llm, { quirks });
  }
}
