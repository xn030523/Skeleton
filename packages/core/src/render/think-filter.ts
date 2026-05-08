const THINK_OPEN_RE = /<(thinking|reasoning|REASONING_SCRATCHPAD|reasoning_content)[^>]*>/;
const THINK_CLOSE_RE = /<\/(thinking|reasoning|REASONING_SCRATCHPAD|reasoning_content)>/;

export function filterThinkBlocks(text: string): string {
  // Remove complete think blocks
  let result = text.replace(
    /<thinking[^>]*>[\s\S]*?<\/thinking>/gi, "",
  );
  result = result.replace(
    /<reasoning[^>]*>[\s\S]*?<\/reasoning>/gi, "",
  );
  result = result.replace(
    /<REASONING_SCRATCHPAD[^>]*>[\s\S]*?<\/REASONING_SCRATCHPAD>/g, "",
  );
  result = result.replace(
    /<reasoning_content[^>]*>[\s\S]*?<\/reasoning_content>/gi, "",
  );

  // Remove unclosed think blocks (tag present but no closing tag — streaming artifact)
  result = result.replace(
    /<(thinking|reasoning|REASONING_SCRATCHPAD|reasoning_content)[^>]*>[\s\S]*$/gi, "",
  );

  return result;
}

export function isInsideThinkBlock(text: string): boolean {
  // Count unbalanced opening tags
  const opens = text.match(THINK_OPEN_RE);
  const closes = text.match(THINK_CLOSE_RE);
  return (opens?.length ?? 0) > (closes?.length ?? 0);
}
