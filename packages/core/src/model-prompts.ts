/**
 * Model-specific system prompt guidance.
 *
 * Different model families respond better to different tool-use instructions.
 * This module inspects a model identifier and returns extra guidance to append
 * to the base system prompt. Kept intentionally short so the prefix cache
 * stays useful across turns.
 *
 * Aligned with Hermes equivalents (GPT_TOOL_USE_GUIDANCE, Gemini execution
 * discipline hints, Codex reasoning hints, Gemma chat hints).
 */

export type ModelFamily =
  | "gpt5"
  | "gpt4"
  | "codex"
  | "gemini"
  | "gemma"
  | "claude"
  | "qwen"
  | "deepseek"
  | "glm"
  | "kimi"
  | "llama"
  | "mistral"
  | "unknown";

/** Detect the model family from the model id. Case-insensitive. */
export function detectModelFamily(model: string | undefined | null): ModelFamily {
  if (!model) return "unknown";
  const m = model.toLowerCase();

  if (m.includes("codex") || m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) return "codex";
  if (m.includes("gpt-5") || m.includes("gpt5")) return "gpt5";
  if (m.includes("gpt-4") || m.includes("gpt4")) return "gpt4";
  if (m.includes("gemma")) return "gemma";
  if (m.includes("gemini")) return "gemini";
  if (m.includes("claude")) return "claude";
  if (m.includes("qwen")) return "qwen";
  if (m.includes("deepseek")) return "deepseek";
  if (m.includes("glm") || m.includes("chatglm")) return "glm";
  if (m.includes("kimi") || m.includes("moonshot")) return "kimi";
  if (m.includes("llama")) return "llama";
  if (m.includes("mistral") || m.includes("mixtral")) return "mistral";

  return "unknown";
}

const GPT_TOOL_USE_GUIDANCE = `## Tool-Use Discipline (GPT)
- Prefer one tool call per turn when outputs are interdependent; batch independent calls in parallel.
- Always read files before editing; never rely on guessed line numbers.
- Do not describe what you are about to do before calling a tool — just call it. Summarize after.
- When a tool returns an error, read the error, correct the arguments, and retry; do not repeat the same call.
- End each turn with a one-sentence status unless the user asked for detail.`;

const CODEX_GUIDANCE = `## Reasoning Model Guidance (Codex / o-series)
- Your reasoning is internal; keep visible output concise.
- Avoid restating the task or narrating each step.
- Prefer decisive action: pick the most likely correct path, execute, verify.
- When uncertain, run a small experiment (read a file, run a command) rather than speculating in prose.`;

const GEMINI_GUIDANCE = `## Execution Discipline (Gemini)
- Before acting, identify the concrete files and symbols involved.
- Use tools in parallel when their inputs are independent.
- After each edit, verify with a quick read or build step before declaring done.
- Do not fabricate file paths, APIs, or CLI flags — look them up in the repo or docs first.
- Keep replies grounded in observed output, not assumptions.`;

const GEMMA_GUIDANCE = `## Gemma Chat Guidance
- You may not have full tool coverage — fall back to clear text instructions when tools are missing.
- Keep answers short and directly address the question.
- Prefer concrete commands and file snippets over abstract descriptions.`;

const QWEN_GUIDANCE = `## Tool-Use Guidance (Qwen)
- Emit a single tool call or a well-formed batch per turn.
- Do not mix natural-language explanations inside tool-call JSON.
- Validate arguments against the tool schema before sending.`;

const DEEPSEEK_GUIDANCE = `## Tool-Use Guidance (DeepSeek)
- Follow the tool schema strictly; arguments must be valid JSON.
- When a tool call fails, adjust arguments rather than repeating verbatim.
- Prefer reading repository files over guessing when uncertain.`;

const GLM_GUIDANCE = `## Tool-Use Guidance (GLM)
- Keep tool arguments minimal and schema-compliant.
- Reason about results before the next tool call; do not chain blindly.`;

const KIMI_GUIDANCE = `## Tool-Use Guidance (Kimi)
- Use the structured tool-call format; do not inline arguments in prose.
- Long-context reads are cheap here — prefer reading full files when context is needed.`;

const LLAMA_GUIDANCE = `## Tool-Use Guidance (Llama)
- Emit tool calls in the configured format exactly; no extra tokens.
- Keep answers terse; avoid restating the user's question.`;

const MISTRAL_GUIDANCE = `## Tool-Use Guidance (Mistral)
- Use JSON-only tool calls; no mixed prose.
- Verify arguments before sending; failed calls count against budget.`;

/**
 * Return extra system-prompt guidance for the given model, or empty string.
 * The returned text is appended to the base system prompt.
 */
export function getModelGuidance(model: string | undefined | null): string {
  const family = detectModelFamily(model);
  switch (family) {
    case "gpt5":
    case "gpt4":
      return GPT_TOOL_USE_GUIDANCE;
    case "codex":
      return CODEX_GUIDANCE;
    case "gemini":
      return GEMINI_GUIDANCE;
    case "gemma":
      return GEMMA_GUIDANCE;
    case "qwen":
      return QWEN_GUIDANCE;
    case "deepseek":
      return DEEPSEEK_GUIDANCE;
    case "glm":
      return GLM_GUIDANCE;
    case "kimi":
      return KIMI_GUIDANCE;
    case "llama":
      return LLAMA_GUIDANCE;
    case "mistral":
      return MISTRAL_GUIDANCE;
    case "claude":
    case "unknown":
    default:
      return "";
  }
}
