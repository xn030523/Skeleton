/**
 * UTF-16 aware message chunking for Telegram.
 * Telegram measures message length in UTF-16 code units, not Unicode codepoints.
 */

function utf16len(s: string): number {
  return [...s].reduce((len, ch) => len + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
}

/**
 * Find the last position <= maxLen where we can safely split.
 * Prefers paragraph boundary (\n\n), then single \n, then space.
 * Never splits inside a fenced code block.
 */
function findSplitPosition(text: string, maxLen: number): number {
  let inCodeBlock = false;
  let bestSplit = -1;
  let charIdx = 0;
  let utf16acc = 0;

  for (let i = 0; i < text.length; i++) {
    const cp = text.codePointAt(i)!;
    const unitLen = cp > 0xffff ? 2 : 1;

    // Track code block state
    if (text[i] === "`" && text[i + 1] === "`" && text[i + 2] === "`") {
      if (utf16acc + unitLen * 3 <= maxLen) {
        // If we're inside a code block and it fits, skip past the close
        inCodeBlock = !inCodeBlock;
      }
      continue;
    }

    if (utf16acc + unitLen > maxLen) break;
    utf16acc += unitLen;
    charIdx = i + 1;

    if (inCodeBlock) continue;

    // Paragraph boundary (best split point)
    if (text[i] === "\n" && text[i + 1] === "\n") {
      bestSplit = i + 2; // split after the double newline
    }
    // Single newline (acceptable split point)
    else if (text[i] === "\n") {
      if (bestSplit === -1 || text[bestSplit - 1] !== "\n") {
        bestSplit = i + 1;
      }
    }
    // Space (last resort split point)
    else if (text[i] === " " && bestSplit === -1) {
      bestSplit = i + 1;
    }
  }

  return bestSplit > 0 ? bestSplit : charIdx;
}

/**
 * Split text into chunks that fit within Telegram's message length limit.
 * Splits at paragraph boundaries (\n\n) when possible.
 * Never splits inside a fenced code block.
 * Appends (N/M) counter to each chunk when multiple chunks are needed.
 */
export function chunkForTelegram(text: string, maxLen = 4000): string[] {
  if (utf16len(text) <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (utf16len(remaining) <= maxLen) {
      chunks.push(remaining);
      break;
    }

    const splitAt = findSplitPosition(remaining, maxLen);
    chunks.push(remaining.slice(0, splitAt).trimEnd());
    remaining = remaining.slice(splitAt).trimStart();
  }

  // Append (N/M) counters
  if (chunks.length > 1) {
    return chunks.map((c, i) => `${c} (${i + 1}/${chunks.length})`);
  }
  return chunks;
}
