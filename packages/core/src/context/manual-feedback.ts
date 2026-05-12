/**
 * User-facing summaries for manual /compress invocations.
 *
 * Port of Hermes `agent/manual_compression_feedback.py`. Produces a consistent
 * structured summary with:
 *   - headline ("Compressed: N → M messages" or "No changes from compression: N messages")
 *   - token_line ("Approx request size: ~X → ~Y tokens" or unchanged variant)
 *   - note (counter-intuitive explanation when message count drops but tokens rise)
 *
 * Used by the /compress command handler in commands/processor.ts so the user
 * sees meaningful before/after stats instead of a bare "Compressed N → M".
 */

import type { Message } from "../types.js";

export interface ManualCompressionSummary {
  /** True when after is identical to before (compression was a no-op) */
  noop: boolean;
  /** First line of user-facing output */
  headline: string;
  /** Token count comparison line */
  tokenLine: string;
  /** Optional extra explanation (e.g. fewer msgs but more tokens after rewrite) */
  note: string | null;
}

/**
 * Compare two message lists shallowly by role + content. Tool-call metadata
 * intentionally ignored — the goal is to detect "compression produced the
 * exact same transcript", not deep-equal structural diff.
 */
function messagesEqual(a: Message[], b: Message[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i].role !== b[i].role) return false;
    if (a[i].content !== b[i].content) return false;
  }
  return true;
}

function formatIntWithCommas(n: number): string {
  return n.toLocaleString("en-US");
}

/**
 * Build user-facing feedback for a manual compression pass.
 *
 * @param beforeMessages Messages before compression ran
 * @param afterMessages  Messages after compression ran
 * @param beforeTokens   Approximate token count before
 * @param afterTokens    Approximate token count after
 */
export function summarizeManualCompression(
  beforeMessages: Message[],
  afterMessages: Message[],
  beforeTokens: number,
  afterTokens: number,
): ManualCompressionSummary {
  const beforeCount = beforeMessages.length;
  const afterCount = afterMessages.length;
  const noop = messagesEqual(beforeMessages, afterMessages);

  let headline: string;
  let tokenLine: string;

  if (noop) {
    headline = `No changes from compression: ${beforeCount} messages`;
    if (afterTokens === beforeTokens) {
      tokenLine = `Approx request size: ~${formatIntWithCommas(beforeTokens)} tokens (unchanged)`;
    } else {
      tokenLine = `Approx request size: ~${formatIntWithCommas(beforeTokens)} → ~${formatIntWithCommas(afterTokens)} tokens`;
    }
  } else {
    headline = `Compressed: ${beforeCount} → ${afterCount} messages`;
    tokenLine = `Approx request size: ~${formatIntWithCommas(beforeTokens)} → ~${formatIntWithCommas(afterTokens)} tokens`;
  }

  let note: string | null = null;
  if (!noop && afterCount < beforeCount && afterTokens > beforeTokens) {
    note =
      "Note: fewer messages can still raise this estimate when " +
      "compression rewrites the transcript into denser summaries.";
  }

  return { noop, headline, tokenLine, note };
}

/**
 * Approximate token count for a message list using the same 4 chars/token
 * heuristic ContextCompressor uses. Exposed here so /compress handlers
 * don't need a private copy.
 */
export function estimateMessageTokens(messages: Message[]): number {
  const CHAR_PER_TOKEN = 4;
  let total = 0;
  for (const m of messages) {
    total += Math.ceil((m.content?.length ?? 0) / CHAR_PER_TOKEN);
    if (m.toolCalls) {
      for (const tc of m.toolCalls) {
        total += Math.ceil(JSON.stringify(tc.arguments).length / CHAR_PER_TOKEN);
      }
    }
  }
  return total;
}
