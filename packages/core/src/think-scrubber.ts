/**
 * Think Scrubber — stateful streaming scrubber that removes
 * reasoning/thinking blocks from model output before displaying
 * to the user.
 *
 * Handles: <think>, <thinking>, <reasoning>, <thought>,
 * <REASONING_SCRATCHPAD>, and ```think...``` blocks.
 *
 * Works across delta boundaries (streaming) so partial blocks
 * are correctly accumulated and stripped.
 *
 * Inspired by Hermes think_scrubber.py.
 */

const OPEN_PATTERNS = [
  /<think>/gi, /<thinking>/gi, /<reasoning>/gi,
  /<thought>/gi, /<REASONING_SCRATCHPAD>/gi,
  /^```think\s*$/gm, /^```thinking\s*$/gm,
];

const CLOSE_PATTERNS = [
  /<\/think>/gi, /<\/thinking>/gi, /<\/reasoning>/gi,
  /<\/thought>/gi, /<\/REASONING_SCRATCHPAD>/gi,
  /^```\s*$/gm,
];

const TAG_PAIRS: Array<{ open: RegExp; close: RegExp }> = [
  { open: /<think>/gi, close: /<\/think>/gi },
  { open: /<thinking>/gi, close: /<\/thinking>/gi },
  { open: /<reasoning>/gi, close: /<\/reasoning>/gi },
  { open: /<thought>/gi, close: /<\/thought>/gi },
  { open: /<REASONING_SCRATCHPAD>/gi, close: /<\/REASONING_SCRATCHPAD>/gi },
  { open: /^```think\s*$/gm, close: /^```\s*$/gm },
  { open: /^```thinking\s*$/gm, close: /^```\s*$/gm },
];

export class StreamingThinkScrubber {
  private insideThink = false;
  private buffer = "";
  private openTag = "";

  /** Feed a chunk of streaming text, return the visible portion */
  feed(chunk: string): string {
    if (this.insideThink) {
      this.buffer += chunk;
      // Check for close tag
      for (const pair of TAG_PAIRS) {
        if (pair.open === this.openTag && pair.close.test(this.buffer)) {
          this.insideThink = false;
          this.buffer = "";
          this.openTag = "";
          return "";
        }
      }
      return ""; // Still inside think block, swallow everything
    }

    // Not inside think block — check for open tag
    for (const pair of TAG_PAIRS) {
      if (pair.open.test(chunk)) {
        this.insideThink = true;
        this.openTag = pair.open;
        this.buffer = chunk;
        // Return any text before the opening tag
        const match = chunk.match(new RegExp(`^(.*?)${pair.open.source}`, pair.open.flags));
        return match?.[1] ?? "";
      }
    }

    return chunk;
  }

  /** Flush any remaining buffered content (end of stream) */
  flush(): string {
    if (this.insideThink) {
      // Unclosed think block at stream end — discard it
      this.insideThink = false;
      this.buffer = "";
      this.openTag = "";
    }
    return "";
  }

  /** Reset scrubber state */
  reset(): void {
    this.insideThink = false;
    this.buffer = "";
    this.openTag = "";
  }
}

/** One-shot scrub: remove all think blocks from complete text */
export function scrubThinkBlocks(text: string): string {
  const scrubber = new StreamingThinkScrubber();
  let result = "";

  // Process line by line for reliable tag detection
  const lines = text.split("\n");
  for (const line of lines) {
    result += scrubber.feed(line + "\n");
  }
  result += scrubber.flush();

  return result.trimEnd();
}
