import fs from "node:fs";
import type { ToolDef } from "../../types.js";

export function hexdumpTool(): ToolDef {
  return {
    name: "hexdump",
    description: "Display a hex dump of a byte range within a file. Shows offset, hex bytes, and ASCII representation side by side. Useful for inspecting headers, structures, and unknown regions.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the file" },
        offset: { type: "number", description: "Byte offset to start from (default 0)", default: 0 },
        length: { type: "number", description: "Number of bytes to display (default 256, max 4096)", default: 256 },
      },
      required: ["path"],
    },
    execute: async (args) => {
      const { path, offset = 0, length = 256 } = args as { path: string; offset?: number; length?: number };
      const clampedLen = Math.min(length, 4096);
      try {
        const buf = Buffer.alloc(clampedLen);
        const fd = fs.openSync(path, "r");
        const bytesRead = fs.readSync(fd, buf, 0, clampedLen, offset);
        fs.closeSync(fd);

        const lines: string[] = [];
        for (let i = 0; i < bytesRead; i += 16) {
          const addr = (offset + i).toString(16).padStart(8, "0");
          const chunk = buf.subarray(i, Math.min(i + 16, bytesRead));
          const hex = Array.from(chunk).map((b) => b.toString(16).padStart(2, "0")).join(" ");
          const ascii = Array.from(chunk).map((b) => (b >= 0x20 && b <= 0x7e) ? String.fromCharCode(b) : ".").join("");
          const hexPad = hex.padEnd(47, " ");
          const asciiPad = ascii.padEnd(16, " ");
          lines.push(`${addr}  ${hexPad}  |${asciiPad}|`);
        }
        return lines.join("\n");
      } catch (err) {
        return { error: `Failed to read file: ${(err as Error).message}` };
      }
    },
  };
}
