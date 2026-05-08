import fs from "node:fs";
import type { ToolDef } from "../../types.js";

function shannonEntropy(buf: Buffer): number {
  const freq = new Float64Array(256);
  for (let i = 0; i < buf.length; i++) freq[buf[i]]++;
  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (freq[i] === 0) continue;
    const p = freq[i] / buf.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

export function entropyTool(): ToolDef {
  return {
    name: "entropy",
    description: "Calculate Shannon entropy of a file or byte range to detect encrypted, compressed, or packed regions. High entropy (>7.0) suggests encryption/packing. Reports per-block entropy and top suspicious blocks.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the file" },
        offset: { type: "number", default: 0, description: "Byte offset to start from" },
        length: { type: "number", description: "Number of bytes to analyze (default: entire file)" },
        blockSize: { type: "number", default: 1024, description: "Block size for per-block analysis (0 to skip)" },
        topBlocks: { type: "number", default: 10, description: "Number of highest-entropy blocks to report" },
      },
      required: ["path"],
    },
    execute: async (args) => {
      const { path, offset = 0, length, blockSize = 1024, topBlocks = 10 } = args as {
        path: string; offset?: number; length?: number; blockSize?: number; topBlocks?: number;
      };
      try {
        const stat = fs.statSync(path);
        const totalLen = length ?? (stat.size - offset);
        const buf = Buffer.alloc(totalLen);
        const fd = fs.openSync(path, "r");
        const bytesRead = fs.readSync(fd, buf, 0, totalLen, offset);
        fs.closeSync(fd);

        const overallEntropy = shannonEntropy(buf.subarray(0, bytesRead));

        let blocks: Array<{ offset: number; entropy: number; suspicious: boolean }> = [];
        if (blockSize > 0) {
          for (let i = 0; i < bytesRead; i += blockSize) {
            const end = Math.min(i + blockSize, bytesRead);
            const ent = shannonEntropy(buf.subarray(i, end));
            blocks.push({ offset: offset + i, entropy: Math.round(ent * 1000) / 1000, suspicious: ent > 7.0 });
          }
          blocks.sort((a, b) => b.entropy - a.entropy);
          blocks = blocks.slice(0, topBlocks);
        }

        const packerHint = overallEntropy > 7.5 ? "very high — likely packed/encrypted"
          : overallEntropy > 7.0 ? "high — possibly packed/compressed"
          : overallEntropy > 5.0 ? "normal — likely contains code and data"
          : "low — likely text or structured data";

        return {
          overallEntropy: Math.round(overallEntropy * 1000) / 1000,
          packerHint,
          fileSize: bytesRead,
          topBlocks: blocks,
        };
      } catch (err) {
        return { error: `Failed to read file: ${(err as Error).message}` };
      }
    },
  };
}
