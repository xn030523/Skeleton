const MAX_TITLE_LEN = 60;

const TITLE_PATTERNS: Array<{ pattern: RegExp; extract: (m: RegExpMatchArray) => string }> = [
  {
    pattern: /^(?:fix|fixing|fixed)\s+(.+)/i,
    extract: m => `Fix: ${m[1]}`,
  },
  {
    pattern: /^(?:add|adding|added)\s+(.+)/i,
    extract: m => `Add: ${m[1]}`,
  },
  {
    pattern: /^(?:implement|implementing|implemented)\s+(.+)/i,
    extract: m => `Implement: ${m[1]}`,
  },
  {
    pattern: /^(?:refactor|refactoring|refactored)\s+(.+)/i,
    extract: m => `Refactor: ${m[1]}`,
  },
  {
    pattern: /^(?:debug|debugging|debugged)\s+(.+)/i,
    extract: m => `Debug: ${m[1]}`,
  },
  {
    pattern: /^(?:create|creating|created)\s+(.+)/i,
    extract: m => `Create: ${m[1]}`,
  },
  {
    pattern: /^(?:update|updating|updated)\s+(.+)/i,
    extract: m => `Update: ${m[1]}`,
  },
  {
    pattern: /^(?:remove|removing|removed)\s+(.+)/i,
    extract: m => `Remove: ${m[1]}`,
  },
  {
    pattern: /(?:how\s+to|how\s+do\s+i|how\s+can\s+i)\s+(.+)/i,
    extract: m => `How to ${m[1]}`,
  },
  {
    pattern: /(?:what\s+is|what's|what\s+are)\s+(.+)/i,
    extract: m => `What is ${m[1]}`,
  },
  {
    pattern: /(?:why\s+(?:does|is|do|are|can))\s+(.+)/i,
    extract: m => `Why ${m[0]}`,
  },
];

function heuristicTitle(userMsg: string, assistantMsg: string): string {
  const firstLine = userMsg.split("\n")[0].trim();

  for (const { pattern, extract } of TITLE_PATTERNS) {
    const m = firstLine.match(pattern);
    if (m) {
      const title = extract(m);
      return title.length > MAX_TITLE_LEN ? title.slice(0, MAX_TITLE_LEN) : title;
    }
  }

  let title = firstLine.length > 50 ? firstLine.slice(0, 50) : firstLine;
  title = title.replace(/\s+/g, " ").trim();
  return title || "Untitled";
}

export async function generateTitle(
  userMsg: string,
  assistantMsg: string,
  modelFn?: (prompt: string) => Promise<string>,
): Promise<string> {
  if (modelFn) {
    try {
      const prompt = `Generate a short session title (max 60 chars, no quotes) summarizing this conversation. Return ONLY the title text.

User: ${userMsg.slice(0, 500)}
Assistant: ${assistantMsg.slice(0, 500)}`;

      const result = await modelFn(prompt);
      const title = result.trim().replace(/^["']|["']$/g, "");
      if (title && title.length > 0) {
        return title.length > MAX_TITLE_LEN ? title.slice(0, MAX_TITLE_LEN) : title;
      }
    } catch {
      // Fall through to heuristic
    }
  }

  return heuristicTitle(userMsg, assistantMsg);
}
