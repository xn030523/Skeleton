const MDV2_ESCAPE_RE = /([_*\[\]()~`>#\+=|{}.!\\-])/g;

export function escapeMDv2(text: string): string {
  return text.replace(MDV2_ESCAPE_RE, "\\$1");
}

/**
 * Convert Markdown text to Telegram MarkdownV2 format.
 *
 * Strategy: walk through the text character by character, tracking whether
 * we're inside a code block, inline code, or plain text. In plain text,
 * convert Markdown formatting to MarkdownV2 equivalents and escape
 * special characters. In code regions, leave content untouched.
 */
export function markdownToMDv2(text: string): string {
  const result: string[] = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    // ─── Fenced code block (```...```) ───
    if (text[i] === "`" && text[i + 1] === "`" && text[i + 2] === "`") {
      const start = i;
      i += 3;
      // Consume optional language label
      while (i < len && text[i] !== "\n") i++;
      if (i < len) i++; // skip the newline
      // Find closing ```
      let closed = false;
      while (i < len) {
        if (text[i] === "`" && text[i + 1] === "`" && text[i + 2] === "`") {
          i += 3;
          closed = true;
          break;
        }
        i++;
      }
      // Extract the code block as-is (no escaping inside)
      result.push(text.slice(start, i));
      continue;
    }

    // ─── Inline code (`...`) ───
    if (text[i] === "`") {
      const start = i;
      i++;
      while (i < len && text[i] !== "`") i++;
      if (i < len) i++; // closing backtick
      result.push(text.slice(start, i));
      continue;
    }

    // ─── Bold (**...**) ───
    if (text[i] === "*" && text[i + 1] === "*") {
      result.push("*"); // MarkdownV2 bold is *text*
      i += 2;
      let depth = 1;
      while (i < len && depth > 0) {
        if (text[i] === "*" && text[i + 1] === "*") {
          depth--;
          if (depth === 0) {
            result.push("*");
            i += 2;
            break;
          }
          result.push("**");
          i += 2;
        } else {
          result.push(escapeMDv2(text[i]));
          i++;
        }
      }
      continue;
    }

    // ─── Italic (*...*) ───
    if (text[i] === "*" && text[i + 1] !== "*") {
      result.push("_"); // MarkdownV2 italic is _text_
      i += 1;
      while (i < len && text[i] !== "*") {
        result.push(escapeMDv2(text[i]));
        i++;
      }
      if (i < len) {
        result.push("_");
        i++;
      }
      continue;
    }

    // ─── Heading (# ...) → bold ───
    if (text[i] === "#" && (i === 0 || text[i - 1] === "\n")) {
      let level = 0;
      while (i < len && text[i] === "#") { level++; i++; }
      if (i < len && text[i] === " ") i++; // skip space after #
      result.push("*"); // MarkdownV2 bold
      // Consume heading text until newline
      while (i < len && text[i] !== "\n") {
        result.push(escapeMDv2(text[i]));
        i++;
      }
      result.push("*");
      if (i < len) { result.push("\n"); i++; }
      continue;
    }

    // ─── Link [text](url) ───
    if (text[i] === "[") {
      const linkStart = i;
      i++;
      let linkText = "";
      while (i < len && text[i] !== "]") {
        linkText += text[i];
        i++;
      }
      if (i < len && text[i + 1] === "(") {
        i += 2; // skip ](
        let url = "";
        while (i < len && text[i] !== ")") {
          url += text[i];
          i++;
        }
        if (i < len) i++; // skip )
        // MarkdownV2 link format
        result.push(`[${escapeMDv2(linkText)}](${escapeMDv2(url)})`);
        continue;
      }
      // Not a link, just a bracket
      result.push(escapeMDv2("[") + escapeMDv2(linkText));
      continue;
    }

    // ─── List item (- or * or + at line start) ───
    if (
      (text[i] === "-" || text[i] === "*" || text[i] === "+") &&
      (i === 0 || text[i - 1] === "\n") &&
      i + 1 < len && text[i + 1] === " "
    ) {
      result.push("• ");
      i += 2;
      continue;
    }

    // ─── Newline ───
    if (text[i] === "\n") {
      result.push("\n");
      i++;
      continue;
    }

    // ─── Plain character ───
    result.push(escapeMDv2(text[i]));
    i++;
  }

  return result.join("");
}
