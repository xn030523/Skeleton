import fs from "node:fs";
import type { ToolDef } from "../../types.js";

export function stringsTool(): ToolDef {
  return {
    name: "strings",
    description: "Extract printable string sequences from a binary file. Supports ASCII and UTF-16LE encodings. Useful for finding API names, URLs, error messages, and embedded text.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the file" },
        encoding: { type: "string", enum: ["ascii", "utf-16le", "both"], default: "both", description: "String encoding to scan for" },
        minLength: { type: "number", default: 4, description: "Minimum string length to report" },
        offset: { type: "number", default: 0, description: "Byte offset to start scanning from" },
        length: { type: "number", description: "Number of bytes to scan (default: entire file, max 10MB)" },
      },
      required: ["path"],
    },
    execute: async (args) => {
      const { path, encoding = "both", minLength = 4, offset = 0, length } = args as {
        path: string; encoding?: string; minLength?: number; offset?: number; length?: number;
      };
      const maxLen = 10 * 1024 * 1024;
      try {
        const stat = fs.statSync(path);
        const scanLen = Math.min(length ?? stat.size - offset, maxLen);
        const buf = Buffer.alloc(scanLen);
        const fd = fs.openSync(path, "r");
        const bytesRead = fs.readSync(fd, buf, 0, scanLen, offset);
        fs.closeSync(fd);

        const results: Array<{ offset: number; encoding: string; string: string }> = [];

        // ASCII scan
        if (encoding === "ascii" || encoding === "both") {
          let runStart = -1;
          for (let i = 0; i < bytesRead; i++) {
            if (buf[i] >= 0x20 && buf[i] <= 0x7e) {
              if (runStart < 0) runStart = i;
            } else {
              if (runStart >= 0 && i - runStart >= minLength) {
                results.push({ offset: offset + runStart, encoding: "ascii", string: buf.subarray(runStart, i).toString("ascii") });
              }
              runStart = -1;
            }
          }
          if (runStart >= 0 && bytesRead - runStart >= minLength) {
            results.push({ offset: offset + runStart, encoding: "ascii", string: buf.subarray(runStart, bytesRead).toString("ascii") });
          }
        }

        // UTF-16LE scan
        if (encoding === "utf-16le" || encoding === "both") {
          let runStart = -1;
          for (let i = 0; i + 1 < bytesRead; i += 2) {
            const lo = buf[i];
            const hi = buf[i + 1];
            if (hi === 0 && lo >= 0x20 && lo <= 0x7e) {
              if (runStart < 0) runStart = i;
            } else {
              if (runStart >= 0 && i - runStart >= minLength * 2) {
                results.push({ offset: offset + runStart, encoding: "utf-16le", string: buf.subarray(runStart, i).toString("utf-16le") });
              }
              runStart = -1;
            }
          }
        }

        return results.slice(0, 500);
      } catch (err) {
        return { error: `Failed to read file: ${(err as Error).message}` };
      }
    },
  };
}
