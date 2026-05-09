export interface FuzzyResult {
  success: boolean;
  result: string;
  strategy?: string;
}

type StrategyFn = (content: string, oldText: string, newText: string) => string | null;

function exactMatch(content: string, oldText: string, newText: string): string | null {
  const idx = content.indexOf(oldText);
  if (idx === -1) return null;
  return content.slice(0, idx) + newText + content.slice(idx + oldText.length);
}

function lineTrimmed(content: string, oldText: string, newText: string): string | null {
  const trimLine = (s: string) => s.split("\n").map(l => l.trim()).join("\n");
  const trimmedContent = trimLine(content);
  const trimmedOld = trimLine(oldText);
  const idx = trimmedContent.indexOf(trimmedOld);
  if (idx === -1) return null;

  let contentIdx = 0;
  let trimmedIdx = 0;
  let matchStart = -1;
  let matchLen = 0;

  const contentLines = content.split("\n");
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  let ci = 0;
  let oi = 0;
  while (ci < contentLines.length && oi < oldLines.length) {
    if (contentLines[ci].trim() === oldLines[oi].trim()) {
      if (oi === 0) matchStart = ci;
      oi++;
      ci++;
    } else {
      oi = 0;
      ci++;
      matchStart = -1;
    }
  }

  if (oi === oldLines.length && matchStart !== -1) {
    const before = contentLines.slice(0, matchStart);
    const after = contentLines.slice(matchStart + oldLines.length);
    return [...before, ...newLines, ...after].join("\n");
  }
  return null;
}

function whitespaceNormalized(content: string, oldText: string, newText: string): string | null {
  const normalize = (s: string) => s.replace(/[ \t]+/g, " ");
  const normContent = normalize(content);
  const normOld = normalize(oldText);
  const idx = normContent.indexOf(normOld);
  if (idx === -1) return null;

  let charMap: number[] = [];
  let normPos = 0;
  for (let i = 0; i < content.length; i++) {
    if (normPos < idx && normContent[normPos] === content[i]) {
      charMap.push(i);
      normPos++;
    } else if (normPos >= idx && normPos < idx + normOld.length) {
      charMap.push(i);
      normPos++;
    }
  }

  const startOrig = charMap[0] ?? -1;
  const endOrig = charMap[charMap.length - 1] ?? -1;
  if (startOrig === -1 || endOrig === -1) return null;

  return content.slice(0, startOrig) + newText + content.slice(endOrig + 1);
}

function indentationFlexible(content: string, oldText: string, newText: string): string | null {
  const stripIndent = (s: string) => s.split("\n").map(l => l.replace(/^[\t ]+/, "")).join("\n");
  const strippedContent = stripIndent(content);
  const strippedOld = stripIndent(oldText);
  const strippedNew = stripIndent(newText);

  const idx = strippedContent.indexOf(strippedOld);
  if (idx === -1) return null;

  const contentLines = content.split("\n");
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  const strippedContentLines = strippedContent.split("\n");
  const strippedOldLines = strippedOld.split("\n");

  let startLine = -1;
  for (let i = 0; i <= strippedContentLines.length - strippedOldLines.length; i++) {
    let match = true;
    for (let j = 0; j < strippedOldLines.length; j++) {
      if (strippedContentLines[i + j] !== strippedOldLines[j]) {
        match = false;
        break;
      }
    }
    if (match) {
      startLine = i;
      break;
    }
  }

  if (startLine === -1) return null;

  const firstOldLine = oldLines[0];
  const indentMatch = firstOldLine.match(/^[\t ]+/);
  const origIndent = indentMatch ? indentMatch[0] : "";
  const contentIndentMatch = contentLines[startLine].match(/^[\t ]+/);
  const contentIndent = contentIndentMatch ? contentIndentMatch[0] : "";

  const adjustedNew = newLines.map(line => {
    if (line.trim().length === 0) return line;
    const strippedNewLine = line.replace(/^[\t ]+/, "");
    return contentIndent + strippedNewLine;
  });

  const before = contentLines.slice(0, startLine);
  const after = contentLines.slice(startLine + oldLines.length);
  return [...before, ...adjustedNew, ...after].join("\n");
}

function escapeNormalized(content: string, oldText: string, newText: string): string | null {
  const unescape = (s: string) =>
    s.replace(/\\n/g, "\n")
     .replace(/\\t/g, "\t")
     .replace(/\\r/g, "\r")
     .replace(/\\\\/g, "\\");

  const unescContent = unescape(content);
  const unescOld = unescape(oldText);
  const idx = unescContent.indexOf(unescOld);
  if (idx === -1) return null;

  let pos = 0;
  let origStart = -1;
  let origEnd = -1;
  let unescPos = 0;

  for (let i = 0; i < content.length; i++) {
    if (unescPos === idx && origStart === -1) origStart = i;
    if (content[i] === "\\" && i + 1 < content.length && "ntr".includes(content[i + 1])) {
      unescPos++;
      i++;
    } else if (content[i] === "\\" && i + 1 < content.length && content[i + 1] === "\\") {
      unescPos++;
      i++;
    } else {
      unescPos++;
    }
    if (unescPos === idx + unescOld.length && origEnd === -1) {
      origEnd = i + 1;
      break;
    }
  }

  if (origStart === -1 || origEnd === -1) return null;
  return content.slice(0, origStart) + newText + content.slice(origEnd);
}

function trimmedBoundary(content: string, oldText: string, newText: string): string | null {
  const trimmedOld = oldText.trim();
  const trimmedContent = content.trim();
  const idx = trimmedContent.indexOf(trimmedOld);
  if (idx === -1) return null;

  const contentLines = content.split("\n");
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  const firstNonEmpty = (lines: string[]) => {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim().length > 0) return i;
    }
    return -1;
  };
  const lastNonEmpty = (lines: string[]) => {
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim().length > 0) return i;
    }
    return -1;
  };

  const oldStart = firstNonEmpty(oldLines);
  const oldEnd = lastNonEmpty(oldLines);
  if (oldStart === -1 || oldEnd === -1) return null;

  const coreOld = oldLines.slice(oldStart, oldEnd + 1).map(l => l.trim()).join("\n");

  for (let ci = 0; ci < contentLines.length; ci++) {
    const contentCore: string[] = [];
    let lineIdx = ci;
    while (lineIdx < contentLines.length && contentCore.length < (oldEnd - oldStart + 1) + 5) {
      if (contentLines[lineIdx].trim().length > 0) {
        contentCore.push(contentLines[lineIdx].trim());
      }
      lineIdx++;
      const joined = contentCore.join("\n");
      if (joined.includes(coreOld)) {
        const coreStartLine = ci;
        const coreEndLine = lineIdx - 1;
        const before = contentLines.slice(0, coreStartLine);
        const after = contentLines.slice(coreEndLine + 1);
        return [...before, ...newLines, ...after].join("\n");
      }
    }
  }

  return null;
}

function blockAnchor(content: string, oldText: string, newText: string): string | null {
  const oldLines = oldText.split("\n");
  const contentLines = content.split("\n");
  const newLines = newText.split("\n");

  if (oldLines.length < 2) return null;

  const firstLine = oldLines[0].trim();
  const lastLine = oldLines[oldLines.length - 1].trim();

  if (firstLine.length === 0 || lastLine.length === 0) return null;

  for (let ci = 0; ci < contentLines.length; ci++) {
    if (contentLines[ci].trim() !== firstLine) continue;

    const maxSpan = oldLines.length * 3;
    for (let endOffset = oldLines.length - 1; endOffset < maxSpan; endOffset++) {
      const endIdx = ci + endOffset;
      if (endIdx >= contentLines.length) break;
      if (contentLines[endIdx].trim() !== lastLine) continue;

      return [
        ...contentLines.slice(0, ci),
        ...newLines,
        ...contentLines.slice(endIdx + 1),
      ].join("\n");
    }
  }

  return null;
}

function contextAware(content: string, oldText: string, newText: string): string | null {
  const contentLines = content.split("\n");
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  if (oldLines.length === 0) return null;

  const contextRadius = 2;
  const paddedOld: string[] = [];
  const paddingStart = Math.min(contextRadius, oldLines.length);

  for (let i = 0; i < oldLines.length; i++) {
    paddedOld.push(oldLines[i]);
  }

  const searchWindow = paddedOld.join("\n");

  for (let ci = 0; ci <= contentLines.length - oldLines.length; ci++) {
    const window = contentLines.slice(ci, ci + oldLines.length).join("\n");

    let matchingLines = 0;
    for (let j = 0; j < oldLines.length; j++) {
      if (contentLines[ci + j].trim() === oldLines[j].trim()) {
        matchingLines++;
      }
    }

    const matchRatio = matchingLines / oldLines.length;
    if (matchRatio >= 0.6) {
      const before = contentLines.slice(0, ci);
      const after = contentLines.slice(ci + oldLines.length);
      return [...before, ...newLines, ...after].join("\n");
    }
  }

  return null;
}

const STRATEGIES: Array<{ name: string; fn: StrategyFn }> = [
  { name: "exact", fn: exactMatch },
  { name: "line-trimmed", fn: lineTrimmed },
  { name: "whitespace-normalized", fn: whitespaceNormalized },
  { name: "indentation-flexible", fn: indentationFlexible },
  { name: "escape-normalized", fn: escapeNormalized },
  { name: "trimmed-boundary", fn: trimmedBoundary },
  { name: "block-anchor", fn: blockAnchor },
  { name: "context-aware", fn: contextAware },
];

export function fuzzyFindAndReplace(
  content: string,
  oldText: string,
  newText: string,
): FuzzyResult {
  for (const { name, fn } of STRATEGIES) {
    const result = fn(content, oldText, newText);
    if (result !== null) {
      return { success: true, result, strategy: name };
    }
  }
  return { success: false, result: content };
}
