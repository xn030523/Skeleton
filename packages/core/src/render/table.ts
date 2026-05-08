/**
 * Convert GFM pipe tables to a MarkdownV2-compatible format.
 * Telegram MarkdownV2 has no table syntax, so we convert to
 * heading + bullet list format.
 */

const TABLE_ROW_RE = /^\|(.+)\|\s*$/;
const TABLE_SEP_RE = /^\|[\s\-:]+\|[\s\-:]+\|/;

export function convertTablesToMDv2(text: string): string {
  const lines = text.split("\n");
  const result: string[] = [];
  let inCodeBlock = false;
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Track code block state
    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      i++;
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      i++;
      continue;
    }

    // Try to match a table: header row + separator row
    const headerMatch = TABLE_ROW_RE.exec(line);
    if (headerMatch && i + 1 < lines.length) {
      const sepMatch = TABLE_SEP_RE.exec(lines[i + 1]);
      if (sepMatch) {
        // We have a table! Parse header and data rows
        const headers = parseCells(headerMatch[1]);
        const dataRows: string[][] = [];
        let j = i + 2;
        while (j < lines.length && TABLE_ROW_RE.test(lines[j])) {
          const cellMatch = TABLE_ROW_RE.exec(lines[j]);
          if (cellMatch) dataRows.push(parseCells(cellMatch[1]));
          j++;
        }

        // Convert to bullet list format
        for (let col = 0; col < headers.length; col++) {
          const headerName = headers[col]?.trim() ?? `Col ${col + 1}`;
          result.push(`**${headerName}**`);
          result.push("──");
          for (const row of dataRows) {
            const val = row[col]?.trim() ?? "";
            if (val) result.push(`  • ${val}`);
          }
          result.push("");
        }

        i = j;
        continue;
      }
    }

    result.push(line);
    i++;
  }

  return result.join("\n");
}

function parseCells(cellStr: string): string[] {
  return cellStr.split("|").map((c) => c.trim());
}
