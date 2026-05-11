/**
 * Transport factory — provider-aware transport selection.
 *
 * Resolves the correct Transport implementation based on the
 * provider's api_mode (chat_completions, anthropic_messages,
 * codex_responses, bedrock_converse) and injects provider quirks
 * (custom headers, auth mode, third-party endpoint handling).
 */

import type { LLMConfig } from "../types.js";
import type { Transport } from "./base.js";
import { ChatCompletionsTransport } from "./chat-completions.js";
import { AnthropicTransport } from "./anthropic.js";
import { CodexResponsesTransport } from "./codex-responses.js";
import { BedrockConverseTransport } from "./bedrock-converse.js";
import { GeminiNativeTransport } from "./gemini-native.js";
import { GeminiCloudCodeTransport } from "./gemini-cloudcode.js";
import { findProvider } from "../providers/registry.js";
import type { ApiMode, ProviderQuirks } from "../providers/registry.js";

/** Create the correct Transport instance based on LLMConfig's provider/apiMode */
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
    case "gemini_native":
      return new GeminiNativeTransport(llm);
    case "gemini_cloudcode":
      return new GeminiCloudCodeTransport(llm);
    case "chat_completions":
    default:
      return new ChatCompletionsTransport(llm, { quirks });
  }
}
