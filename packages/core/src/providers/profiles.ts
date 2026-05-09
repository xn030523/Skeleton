/**
 * Provider Profile Definitions — 26+ v1 providers with transport quirks.
 *
 * Each registerProvider() call defines a provider with its API endpoint,
 * env var resolution order, default model, api mode, and transport quirks
 * (auth mode, custom headers, third-party endpoint handling, etc.).
 *
 * Inspired by Hermes 33 provider profiles + adapter quirks system.
 * v2 will add: bedrock (aws_sdk), copilot (oauth), OAuth flows, etc.
 */

import { registerProvider } from "./registry.js";

// ── Tier 1: Major cloud providers ──────────────────────────────────

registerProvider({
  name: "openai",
  aliases: ["gpt"],
  apiMode: "chat_completions",
  baseUrl: "https://api.openai.com",
  apiKeyEnvVars: ["OPENAI_API_KEY"],
  defaultModel: "gpt-4o",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 16384 },
});

registerProvider({
  name: "anthropic",
  aliases: ["claude"],
  apiMode: "anthropic_messages",
  baseUrl: "https://api.anthropic.com",
  apiKeyEnvVars: ["ANTHROPIC_API_KEY"],
  defaultModel: "claude-sonnet-4-20250514",
  quirks: { maxOutputTokens: 8192 },
});

registerProvider({
  name: "gemini",
  aliases: ["google"],
  apiMode: "chat_completions",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  apiKeyEnvVars: ["GOOGLE_API_KEY", "GEMINI_API_KEY"],
  defaultModel: "gemini-2.5-flash",
  quirks: { maxOutputTokens: 65536 },
});

registerProvider({
  name: "azure-foundry",
  aliases: ["azure"],
  apiMode: "chat_completions",
  baseUrl: "https://models.inference.ai.azure.com",
  apiKeyEnvVars: ["AZURE_API_KEY", "GITHUB_TOKEN"],
  defaultModel: "gpt-4o",
  quirks: {
    authMode: "api-key",
    queryParams: { "api-version": "2025-04-15" },
    maxOutputTokens: 16384,
  },
});

// ── Tier 2: Chinese providers ───────────────────────────────────────

registerProvider({
  name: "deepseek",
  aliases: [],
  apiMode: "chat_completions",
  baseUrl: "https://api.deepseek.com",
  apiKeyEnvVars: ["DEEPSEEK_API_KEY"],
  defaultModel: "deepseek-chat",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 8192 },
});

registerProvider({
  name: "alibaba",
  aliases: ["tongyi", "qwen"],
  apiMode: "chat_completions",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
  apiKeyEnvVars: ["DASHSCOPE_API_KEY", "ALIBABA_API_KEY"],
  defaultModel: "qwen-plus",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 8192 },
});

registerProvider({
  name: "alibaba-coding",
  aliases: ["qwen-coder"],
  apiMode: "chat_completions",
  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode",
  apiKeyEnvVars: ["DASHSCOPE_API_KEY", "ALIBABA_API_KEY"],
  defaultModel: "qwen-coder-plus-latest",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 8192 },
});

registerProvider({
  name: "minimax",
  aliases: [],
  apiMode: "anthropic_messages",
  baseUrl: "https://api.minimax.chat",
  apiKeyEnvVars: ["MINIMAX_API_KEY"],
  defaultModel: "MiniMax-Text-01",
  quirks: {
    authMode: "bearer",
    isThirdPartyAnthropic: true,
    stripBetaHeaders: ["fine-grained-tool-streaming"],
    stripSignedThinking: true,
    noCaching: true,
    maxOutputTokens: 65536,
  },
});

registerProvider({
  name: "minimax-cn",
  aliases: [],
  apiMode: "anthropic_messages",
  baseUrl: "https://api.minimax.chat",
  apiKeyEnvVars: ["MINIMAX_API_KEY"],
  defaultModel: "MiniMax-Text-01",
  quirks: {
    authMode: "bearer",
    isThirdPartyAnthropic: true,
    stripBetaHeaders: ["fine-grained-tool-streaming"],
    stripSignedThinking: true,
    noCaching: true,
    maxOutputTokens: 65536,
  },
});

registerProvider({
  name: "kimi-coding",
  aliases: ["kimi", "moonshot"],
  apiMode: "chat_completions",
  baseUrl: "https://api.kimi.moonshot.cn",
  apiKeyEnvVars: ["MOONSHOT_API_KEY", "KIMI_API_KEY"],
  defaultModel: "moonshot-v1-auto",
  quirks: {
    urlSuffix: "/v1",
    customHeaders: { "User-Agent": "claude-code/0.1.0" },
    maxOutputTokens: 8192,
  },
});

registerProvider({
  name: "kimi-coding-cn",
  aliases: [],
  apiMode: "chat_completions",
  baseUrl: "https://api.kimi.moonshot.cn",
  apiKeyEnvVars: ["KIMI_API_KEY", "MOONSHOT_API_KEY"],
  defaultModel: "moonshot-v1-auto",
  quirks: {
    urlSuffix: "/v1",
    customHeaders: { "User-Agent": "claude-code/0.1.0" },
    maxOutputTokens: 8192,
  },
});

registerProvider({
  name: "stepfun",
  aliases: ["step"],
  apiMode: "chat_completions",
  baseUrl: "https://api.stepfun.com",
  apiKeyEnvVars: ["STEPFUN_API_KEY"],
  defaultModel: "step-2",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 8192 },
});

registerProvider({
  name: "xiaomi",
  aliases: ["mi"],
  apiMode: "chat_completions",
  baseUrl: "https://api.xiaomi.com",
  apiKeyEnvVars: ["XIAOMI_API_KEY"],
  defaultModel: "mi-max",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 8192 },
});

// ── Tier 3: Router / aggregator providers ───────────────────────────

registerProvider({
  name: "openrouter",
  aliases: [],
  apiMode: "chat_completions",
  baseUrl: "https://openrouter.ai/api",
  apiKeyEnvVars: ["OPENROUTER_API_KEY"],
  defaultModel: "openai/gpt-4o",
  quirks: {
    urlSuffix: "/v1",
    customHeaders: { "HTTP-Referer": "https://skeleton.agent", "X-Title": "Skeleton" },
    maxOutputTokens: 16384,
  },
});

registerProvider({
  name: "ai-gateway",
  aliases: ["aigw"],
  apiMode: "chat_completions",
  baseUrl: "https://api.aigateway.dev",
  apiKeyEnvVars: ["AI_GATEWAY_API_KEY"],
  defaultModel: "gpt-4o",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 16384 },
});

// ── Tier 4: Specialized / research providers ────────────────────────

registerProvider({
  name: "arcee",
  aliases: [],
  apiMode: "chat_completions",
  baseUrl: "https://api.arcee.ai",
  apiKeyEnvVars: ["ARCEE_API_KEY"],
  defaultModel: "arcee-flash",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 4096 },
});

registerProvider({
  name: "huggingface",
  aliases: ["hf"],
  apiMode: "chat_completions",
  baseUrl: "https://api-inference.huggingface.co/v1",
  apiKeyEnvVars: ["HF_API_KEY", "HUGGING_FACE_HUB_TOKEN"],
  defaultModel: "meta-llama/Llama-3.3-70B-Instruct",
  quirks: { maxOutputTokens: 4096 },
});

registerProvider({
  name: "nvidia",
  aliases: ["nim"],
  apiMode: "chat_completions",
  baseUrl: "https://integrate.api.nvidia.com",
  apiKeyEnvVars: ["NVIDIA_API_KEY", "NIM_API_KEY"],
  defaultModel: "meta/llama3-70b-instruct",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 4096 },
});

registerProvider({
  name: "nous",
  aliases: [],
  apiMode: "chat_completions",
  baseUrl: "https://api.nousresearch.com",
  apiKeyEnvVars: ["NOUS_API_KEY"],
  defaultModel: "Hermes-3-Llama-3-8B",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 4096 },
});

registerProvider({
  name: "xai",
  aliases: ["grok"],
  apiMode: "chat_completions",
  baseUrl: "https://api.x.ai",
  apiKeyEnvVars: ["XAI_API_KEY"],
  defaultModel: "grok-3",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 16384 },
});

// ── Tier 5: Local / self-hosted providers ──────────────────────────

registerProvider({
  name: "ollama",
  aliases: ["ollama-cloud", "local"],
  apiMode: "chat_completions",
  baseUrl: "http://localhost:11434",
  apiKeyEnvVars: [],
  defaultModel: "llama3",
  quirks: { urlSuffix: "/v1", skipApiKey: true, maxOutputTokens: 4096 },
});

registerProvider({
  name: "lm-studio",
  aliases: ["lmstudio"],
  apiMode: "chat_completions",
  baseUrl: "http://localhost:1234",
  apiKeyEnvVars: [],
  defaultModel: "default",
  quirks: { urlSuffix: "/v1", skipApiKey: true, maxOutputTokens: 4096 },
});

// ── Tier 6: Emerging / niche providers ──────────────────────────────

registerProvider({
  name: "gmi",
  aliases: [],
  apiMode: "chat_completions",
  baseUrl: "https://api.gmi.cloud",
  apiKeyEnvVars: ["GMI_API_KEY"],
  defaultModel: "gmi-4o",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 8192 },
});

registerProvider({
  name: "kilocode",
  aliases: [],
  apiMode: "chat_completions",
  baseUrl: "https://api.kilocode.ai",
  apiKeyEnvVars: ["KILOCODE_API_KEY"],
  defaultModel: "kilocode-v1",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 4096 },
});

registerProvider({
  name: "opencode-zen",
  aliases: ["zen"],
  apiMode: "chat_completions",
  baseUrl: "https://api.opencode.ai",
  apiKeyEnvVars: ["ZEN_API_KEY"],
  defaultModel: "zen-1",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 4096 },
});

registerProvider({
  name: "opencode-go",
  aliases: [],
  apiMode: "chat_completions",
  baseUrl: "https://api.opencode.ai",
  apiKeyEnvVars: ["OPENCODE_API_KEY"],
  defaultModel: "opencode-go-v1",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 4096 },
});

registerProvider({
  name: "zai",
  aliases: [],
  apiMode: "chat_completions",
  baseUrl: "https://api.zai.chat",
  apiKeyEnvVars: ["ZAI_API_KEY"],
  defaultModel: "zai-1",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 4096 },
});

// ── Tier 7: Serverless inference providers ────────────────────────────

registerProvider({
  name: "fireworks",
  aliases: ["fw"],
  apiMode: "chat_completions",
  baseUrl: "https://api.fireworks.ai/inference",
  apiKeyEnvVars: ["FIREWORKS_API_KEY", "FIREWORKS_API_KEY"],
  defaultModel: "accounts/fireworks/models/llama-v3p1-70b-instruct",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 16384 },
});

registerProvider({
  name: "together",
  aliases: ["together-ai", "tgl"],
  apiMode: "chat_completions",
  baseUrl: "https://api.together.xyz",
  apiKeyEnvVars: ["TOGETHER_API_KEY"],
  defaultModel: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 4096 },
});

registerProvider({
  name: "groq",
  aliases: [],
  apiMode: "chat_completions",
  baseUrl: "https://api.groq.com",
  apiKeyEnvVars: ["GROQ_API_KEY"],
  defaultModel: "llama-3.3-70b-versatile",
  quirks: { urlSuffix: "/openai/v1", maxOutputTokens: 32768 },
});

registerProvider({
  name: "cerebras",
  aliases: [],
  apiMode: "chat_completions",
  baseUrl: "https://api.cerebras.ai",
  apiKeyEnvVars: ["CEREBRAS_API_KEY"],
  defaultModel: "llama-3.3-70b",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 4096 },
});

registerProvider({
  name: "sambanova",
  aliases: ["samba"],
  apiMode: "chat_completions",
  baseUrl: "https://api.sambanova.ai",
  apiKeyEnvVars: ["SAMBANOVA_API_KEY"],
  defaultModel: "Meta-Llama-3.1-70B-Instruct",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 4096 },
});

// ── Tier 8: v2 planned providers (api_mode defined, deferred auth) ──

registerProvider({
  name: "openai-codex",
  aliases: ["codex"],
  apiMode: "codex_responses",
  baseUrl: "https://api.openai.com",
  apiKeyEnvVars: ["OPENAI_API_KEY"],
  defaultModel: "codex-mini-latest",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 16384 },
});

registerProvider({
  name: "bedrock",
  aliases: ["aws"],
  apiMode: "bedrock_converse",
  baseUrl: "", // Bedrock doesn't use base URL — resolved via AWS SDK
  apiKeyEnvVars: ["AWS_ACCESS_KEY_ID"],
  defaultModel: "anthropic.claude-sonnet-4-20250514",
  quirks: { skipApiKey: true, maxOutputTokens: 8192 },
});

registerProvider({
  name: "deepseek-anthropic",
  aliases: ["deepseek-claude"],
  apiMode: "anthropic_messages",
  baseUrl: "https://api.deepseek.com",
  apiKeyEnvVars: ["DEEPSEEK_API_KEY"],
  defaultModel: "deepseek-r1",
  quirks: {
    urlSuffix: "/anthropic",
    authMode: "bearer",
    isThirdPartyAnthropic: true,
    stripSignedThinking: true,
    noCaching: true,
    maxOutputTokens: 8192,
  },
});

registerProvider({
  name: "copilot",
  aliases: ["github-copilot"],
  apiMode: "chat_completions",
  baseUrl: "https://api.githubcopilot.com",
  apiKeyEnvVars: ["GH_TOKEN", "GITHUB_TOKEN"],
  defaultModel: "gpt-4o",
  quirks: { urlSuffix: "/v1", maxOutputTokens: 16384 },
});
