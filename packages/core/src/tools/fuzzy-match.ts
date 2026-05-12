/**
 * Fuzzy Matching for file edits — 9 strategy chain.
 *
 * Port of Hermes `tools/fuzzy_match.py` (1:1 semantics, same thresholds).
 * Strategies tried in order; first one with matches wins:
 *
 *   1. exact                — direct string comparison
 *   2. line_trimmed         — strip leading/trailing whitespace per line
 *   3. whitespace_normalized — collapse multiple spaces/tabs to single space
 *   4. indentation_flexible — ignore indentation entirely (lstrip each line)
 *   5. escape_normalized    — convert \\n \\t \\r literals to actual chars
 *   6. trimmed_boundary     — trim first/last line whitespace only
 *   7. unicode_normalized   — normalize smart quotes / dashes / ellipsis
 *   8. block_anchor         — match first+last lines, similarity gate middle
 *                             (threshold 0.50 unique / 0.70 multi)
 *   9. context_aware        — line-by-line similarity, 50% of lines ≥ 0.80
 *
 * Multi-occurrence matching is controlled by replaceAll flag.
 * Includes escape-drift detection — blocks writes that look like
 * tool-call serialization artifacts (\\' / \\" added spuriously).
 */

/** Unicode → ASCII map for strategy 7. Order must not matter (single-char keys). */
const UNICODE_MAP: Record<string, string> = {
  "\u201c": '"', "\u201d": '"',   // smart double quotes
  "\u2018": "'", "\u2019": "'",   // smart single quotes
  "\u2014": "--", "\u2013": "-",  // em / en dash
  "\u2026": "...",                // ellipsis
  "\u00a0": " ",                  // non-breaking space
};

function unicodeNormalize(text: string): string {
  let out = text;
  for (const [ch, repl] of Object.entries(UNICODE_MAP)) {
    if (out.includes(ch)) out = out.split(ch).join(repl);
  }
  return out;
}

export interface FuzzyMatchResult {
  newContent: string;
  matchCount: number;
  strategy: string | null;
  error: string | null;
}

type Match = [number, number];

export function fuzzyFindAndReplace(
  content: string,
  oldString: string,
  newString: string,
  replaceAll = false,
): FuzzyMatchResult {
  if (!oldString) {
    return { newContent: content, matchCount: 0, strategy: null, error: "old_string cannot be empty" };
  }
  if (oldString === newString) {
    return { newContent: content, matchCount: 0, strategy: null, error: "old_string and new_string are identical" };
  }

  const strategies: Array<[string, (c: string, p: string) => Match[]]> = [
    ["exact", strategyExact],
    ["line_trimmed", strategyLineTrimmed],
    ["whitespace_normalized", strategyWhitespaceNormalized],
    ["indentation_flexible", strategyIndentationFlexible],
    ["escape_normalized", strategyEscapeNormalized],
    ["trimmed_boundary", strategyTrimmedBoundary],
    ["unicode_normalized", strategyUnicodeNormalized],
    ["block_anchor", strategyBlockAnchor],
    ["context_aware", strategyContextAware],
  ];

  for (const [name, fn] of strategies) {
    const matches = fn(content, oldString);
    if (matches.length === 0) continue;

    if (matches.length > 1 && !replaceAll) {
      return {
        newContent: content,
        matchCount: 0,
        strategy: null,
        error: `Found ${matches.length} matches for old_string. Provide more context to make it unique, or use replace_all=true.`,
      };
    }

    // Escape-drift guard: if matched via normalization (not exact),
    // check for \\' / \\" drift artifacts.
    if (name !== "exact") {
      const drift = detectEscapeDrift(content, matches, oldString, newString);
      if (drift) {
        return { newContent: content, matchCount: 0, strategy: null, error: drift };
      }
    }

    const newContent = applyReplacements(content, matches, newString);
    return { newContent, matchCount: matches.length, strategy: name, error: null };
  }

  return {
    newContent: content,
    matchCount: 0,
    strategy: null,
    error: "Could not find a match for old_string in the file",
  };
}

function detectEscapeDrift(
  content: string,
  matches: Match[],
  oldString: string,
  newString: string,
): string | null {
  if (!newString.includes("\\'") && !newString.includes('\\"')) return null;

  const matchedRegions = matches.map(([s, e]) => content.slice(s, e)).join("");
  for (const suspect of ["\\'", '\\"']) {
    if (
      newString.includes(suspect) &&
      oldString.includes(suspect) &&
      !matchedRegions.includes(suspect)
    ) {
      const plain = suspect[1];
      return (
        `Escape-drift detected: old_string and new_string contain the literal sequence ` +
        `"${suspect}" but the matched region of the file does not. This is almost always ` +
        `a tool-call serialization artifact where an apostrophe or quote got prefixed with ` +
        `a spurious backslash. Re-read the file with read_file and pass old_string/new_string ` +
        `without backslash-escaping ${plain} characters.`
      );
    }
  }
  return null;
}

function applyReplacements(content: string, matches: Match[], newString: string): string {
  // Replace from end → start so earlier positions remain valid.
  const sorted = [...matches].sort((a, b) => b[0] - a[0]);
  let result = content;
  for (const [start, end] of sorted) {
    result = result.slice(0, start) + newString + result.slice(end);
  }
  return result;
}

// ── Strategy 1: exact ────────────────────────────────────────────────
function strategyExact(content: string, pattern: string): Match[] {
  const matches: Match[] = [];
  let start = 0;
  while (true) {
    const pos = content.indexOf(pattern, start);
    if (pos === -1) break;
    matches.push([pos, pos + pattern.length]);
    start = pos + 1;
  }
  return matches;
}

// ── Strategy 2: line_trimmed ─────────────────────────────────────────
function strategyLineTrimmed(content: string, pattern: string): Match[] {
  const patternLines = pattern.split("\n").map(l => l.trim());
  const patternNorm = patternLines.join("\n");
  const contentLines = content.split("\n");
  const contentNormLines = contentLines.map(l => l.trim());
  return findNormalizedMatches(content, contentLines, contentNormLines, patternNorm);
}

// ── Strategy 3: whitespace_normalized ────────────────────────────────
function strategyWhitespaceNormalized(content: string, pattern: string): Match[] {
  const normalize = (s: string) => s.replace(/[ \t]+/g, " ");
  const patternNorm = normalize(pattern);
  const contentNorm = normalize(content);
  const normMatches = strategyExact(contentNorm, patternNorm);
  if (normMatches.length === 0) return [];
  return mapNormalizedPositions(content, contentNorm, normMatches);
}

// ── Strategy 4: indentation_flexible ─────────────────────────────────
function strategyIndentationFlexible(content: string, pattern: string): Match[] {
  const contentLines = content.split("\n");
  const contentStrippedLines = contentLines.map(l => l.replace(/^\s+/, ""));
  const patternLines = pattern.split("\n").map(l => l.replace(/^\s+/, ""));
  return findNormalizedMatches(content, contentLines, contentStrippedLines, patternLines.join("\n"));
}

// ── Strategy 5: escape_normalized ────────────────────────────────────
function strategyEscapeNormalized(content: string, pattern: string): Match[] {
  const unescape = (s: string) =>
    s.replace(/\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\r/g, "\r");
  const patternUnescaped = unescape(pattern);
  if (patternUnescaped === pattern) return [];
  return strategyExact(content, patternUnescaped);
}

// ── Strategy 6: trimmed_boundary ─────────────────────────────────────
function strategyTrimmedBoundary(content: string, pattern: string): Match[] {
  const patternLines = pattern.split("\n");
  if (patternLines.length === 0) return [];
  patternLines[0] = patternLines[0].trim();
  if (patternLines.length > 1) patternLines[patternLines.length - 1] = patternLines[patternLines.length - 1].trim();
  const modifiedPattern = patternLines.join("\n");
  const contentLines = content.split("\n");
  const matches: Match[] = [];
  const patternLineCount = patternLines.length;

  for (let i = 0; i <= contentLines.length - patternLineCount; i++) {
    const block = contentLines.slice(i, i + patternLineCount);
    const check = [...block];
    check[0] = check[0].trim();
    if (check.length > 1) check[check.length - 1] = check[check.length - 1].trim();
    if (check.join("\n") === modifiedPattern) {
      matches.push(calculateLinePositions(contentLines, i, i + patternLineCount, content.length));
    }
  }
  return matches;
}

// ── Strategy 7: unicode_normalized ───────────────────────────────────
function strategyUnicodeNormalized(content: string, pattern: string): Match[] {
  const normPattern = unicodeNormalize(pattern);
  const normContent = unicodeNormalize(content);
  if (normContent === content && normPattern === pattern) return [];

  let normMatches = strategyExact(normContent, normPattern);
  if (normMatches.length === 0) {
    normMatches = strategyLineTrimmed(normContent, normPattern);
  }
  if (normMatches.length === 0) return [];

  const origToNorm = buildOrigToNormMap(content);
  return mapPositionsNormToOrig(origToNorm, normMatches);
}

// ── Strategy 8: block_anchor (similarity gate) ───────────────────────
function strategyBlockAnchor(content: string, pattern: string): Match[] {
  const normPattern = unicodeNormalize(pattern);
  const normContent = unicodeNormalize(content);
  const patternLines = normPattern.split("\n");
  if (patternLines.length < 2) return [];

  const firstLine = patternLines[0].trim();
  const lastLine = patternLines[patternLines.length - 1].trim();
  const normContentLines = normContent.split("\n");
  const origContentLines = content.split("\n");
  const patternLineCount = patternLines.length;

  const potential: number[] = [];
  for (let i = 0; i <= normContentLines.length - patternLineCount; i++) {
    if (
      normContentLines[i].trim() === firstLine &&
      normContentLines[i + patternLineCount - 1].trim() === lastLine
    ) {
      potential.push(i);
    }
  }

  // Threshold: 0.50 unique / 0.70 multiple candidates.
  const threshold = potential.length === 1 ? 0.50 : 0.70;
  const matches: Match[] = [];

  for (const i of potential) {
    let similarity: number;
    if (patternLineCount <= 2) {
      similarity = 1.0;
    } else {
      const contentMiddle = normContentLines.slice(i + 1, i + patternLineCount - 1).join("\n");
      const patternMiddle = patternLines.slice(1, -1).join("\n");
      similarity = sequenceSimilarity(contentMiddle, patternMiddle);
    }
    if (similarity >= threshold) {
      matches.push(calculateLinePositions(origContentLines, i, i + patternLineCount, content.length));
    }
  }
  return matches;
}

// ── Strategy 9: context_aware (line-similarity threshold) ────────────
function strategyContextAware(content: string, pattern: string): Match[] {
  const patternLines = pattern.split("\n");
  const contentLines = content.split("\n");
  if (patternLines.length === 0) return [];

  const matches: Match[] = [];
  const patternLineCount = patternLines.length;

  for (let i = 0; i <= contentLines.length - patternLineCount; i++) {
    const blockLines = contentLines.slice(i, i + patternLineCount);
    let highCount = 0;
    for (let j = 0; j < patternLineCount; j++) {
      const sim = sequenceSimilarity(patternLines[j].trim(), blockLines[j].trim());
      if (sim >= 0.80) highCount++;
    }
    if (highCount >= patternLines.length * 0.5) {
      matches.push(calculateLinePositions(contentLines, i, i + patternLineCount, content.length));
    }
  }
  return matches;
}

// ── Helpers ──────────────────────────────────────────────────────────

function calculateLinePositions(
  contentLines: string[],
  startLine: number,
  endLine: number,
  contentLength: number,
): Match {
  let startPos = 0;
  for (let i = 0; i < startLine; i++) startPos += contentLines[i].length + 1;
  let endPos = 0;
  for (let i = 0; i < endLine; i++) endPos += contentLines[i].length + 1;
  endPos -= 1;
  if (endPos >= contentLength) endPos = contentLength;
  return [startPos, endPos];
}

function findNormalizedMatches(
  content: string,
  contentLines: string[],
  contentNormLines: string[],
  patternNorm: string,
): Match[] {
  const patternNormLines = patternNorm.split("\n");
  const n = patternNormLines.length;
  const matches: Match[] = [];
  for (let i = 0; i <= contentNormLines.length - n; i++) {
    const block = contentNormLines.slice(i, i + n).join("\n");
    if (block === patternNorm) {
      matches.push(calculateLinePositions(contentLines, i, i + n, content.length));
    }
  }
  return matches;
}

function mapNormalizedPositions(
  original: string,
  normalized: string,
  normMatches: Match[],
): Match[] {
  // Build a map from normalized index → original index by walking in lock-step.
  // When original[i] and normalized[j] are the same char, step both. When a
  // whitespace run collapses in normalized, step original forward until they
  // rejoin.
  const normToOrig: number[] = new Array(normalized.length + 1).fill(0);
  let origIdx = 0;
  for (let normIdx = 0; normIdx <= normalized.length; normIdx++) {
    normToOrig[normIdx] = origIdx;
    if (normIdx === normalized.length) break;
    const nCh = normalized[normIdx];
    // Advance origIdx until its char matches nCh (for whitespace collapse case)
    while (
      origIdx < original.length &&
      original[origIdx] !== nCh &&
      /\s/.test(original[origIdx])
    ) {
      origIdx++;
    }
    if (origIdx < original.length) origIdx++;
  }
  return normMatches.map(([ns, ne]) => [normToOrig[ns], normToOrig[ne]] as Match);
}

function buildOrigToNormMap(original: string): number[] {
  // Entry i = normalized index that original character i maps to.
  // Handles UNICODE_MAP expansions (em-dash → --, ellipsis → ...).
  const result: number[] = [];
  let normPos = 0;
  for (const ch of original) {
    result.push(normPos);
    const repl = UNICODE_MAP[ch];
    normPos += repl !== undefined ? repl.length : 1;
  }
  result.push(normPos);
  return result;
}

function mapPositionsNormToOrig(origToNorm: number[], normMatches: Match[]): Match[] {
  const normToOrigStart: Map<number, number> = new Map();
  for (let i = 0; i < origToNorm.length - 1; i++) {
    const np = origToNorm[i];
    if (!normToOrigStart.has(np)) normToOrigStart.set(np, i);
  }
  const origLen = origToNorm.length - 1;
  const out: Match[] = [];
  for (const [normStart, normEnd] of normMatches) {
    const origStart = normToOrigStart.get(normStart);
    if (origStart === undefined) continue;
    let origEnd = origStart;
    while (origEnd < origLen && origToNorm[origEnd] < normEnd) origEnd++;
    out.push([origStart, origEnd]);
  }
  return out;
}

/** Ratcliff-Obershelp-style similarity via longest common subsequence (0..1). */
function sequenceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  // Use length-weighted matching-blocks heuristic (closer to Python SequenceMatcher.ratio).
  const matches = countMatchingBlocks(a, b);
  return (2 * matches) / (a.length + b.length);
}

function countMatchingBlocks(a: string, b: string): number {
  // Greedy longest-common-substring recursion (matches Python difflib approach).
  let total = 0;
  const stack: Array<[number, number, number, number]> = [[0, a.length, 0, b.length]];
  while (stack.length > 0) {
    const [alo, ahi, blo, bhi] = stack.pop()!;
    const [i, j, k] = findLongestMatch(a, alo, ahi, b, blo, bhi);
    if (k > 0) {
      total += k;
      if (alo < i && blo < j) stack.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) stack.push([i + k, ahi, j + k, bhi]);
    }
  }
  return total;
}

function findLongestMatch(
  a: string, alo: number, ahi: number,
  b: string, blo: number, bhi: number,
): [number, number, number] {
  let bestI = alo, bestJ = blo, bestK = 0;
  const j2len: Map<number, number> = new Map();
  for (let i = alo; i < ahi; i++) {
    const newJ2len: Map<number, number> = new Map();
    for (let j = blo; j < bhi; j++) {
      if (a[i] !== b[j]) continue;
      const k = (j2len.get(j - 1) ?? 0) + 1;
      newJ2len.set(j, k);
      if (k > bestK) {
        bestI = i - k + 1;
        bestJ = j - k + 1;
        bestK = k;
      }
    }
    j2len.clear();
    for (const [j, k] of newJ2len) j2len.set(j, k);
  }
  return [bestI, bestJ, bestK];
}
