/**
 * LM Studio reasoning-effort resolution.
 *
 * Port of Hermes `agent/lmstudio_reasoning.py`.
 *
 * LM Studio publishes per-model `capabilities.reasoning.allowed_options`
 * (e.g. ["off","on"] for toggle-style, ["off","minimal","low"] for graduated).
 * We map the user's `reasoningEffort` onto LM Studio's OpenAI-compatible
 * vocabulary, then clamp against the model's allowed set so the server
 * doesn't 400 on an unsupported effort.
 */

const LM_VALID_EFFORTS = new Set(["none", "minimal", "low", "medium", "high", "xhigh"]);

// Toggle-style models publish allowed_options as ["off","on"].
// Map them onto the OpenAI-compatible request vocabulary.
const LM_EFFORT_ALIASES: Record<string, string> = { off: "none", on: "medium" };

/**
 * Return the `reasoning_effort` string to send to LM Studio, or `null`.
 *
 * `null` means "omit the field": the user picked a level the model can't
 * honor, so let LM Studio fall back to the model's declared default rather
 * than silently substituting a different effort. When `allowedOptions` is
 * empty/null (probe failed), skip clamping and send the resolved effort anyway.
 */
export function resolveLmStudioEffort(
  reasoningEffort: string | undefined | null,
  allowedOptions: string[] | null | undefined,
): string | null {
  let effort = "medium";

  if (reasoningEffort) {
    const raw = (LM_EFFORT_ALIASES[reasoningEffort.toLowerCase()] ?? reasoningEffort).toLowerCase();
    if (LM_VALID_EFFORTS.has(raw)) effort = raw;
  }

  if (allowedOptions && allowedOptions.length > 0) {
    const allowed = new Set(allowedOptions.map(opt => LM_EFFORT_ALIASES[opt] ?? opt));
    if (!allowed.has(effort)) return null;
  }

  return effort;
}

/** True when the base URL looks like an LM Studio endpoint. */
export function isLmStudioEndpoint(baseUrl: string | undefined | null): boolean {
  if (!baseUrl) return false;
  const url = baseUrl.toLowerCase();
  return url.includes("localhost:1234") || url.includes("127.0.0.1:1234") || url.includes("lmstudio");
}
