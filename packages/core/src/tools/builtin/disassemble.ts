import type { ToolDef } from "../../types.js";

export function disassembleTool(): ToolDef {
  return {
    name: "disassemble",
    description: "Disassemble machine code bytes into assembly instructions. Supports x86 (16/32/64-bit) and ARM (32-bit/Thumb). Requires optional @alexaltea/capstone-js package.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the binary file" },
        offset: { type: "number", description: "Byte offset in the file to start disassembly" },
        length: { type: "number", default: 256, description: "Number of bytes to disassemble (max 4096)" },
        architecture: { type: "string", enum: ["x86-16", "x86-32", "x86-64", "arm-32", "arm-thumb"], default: "x86-64", description: "Target architecture and mode" },
        baseAddress: { type: "number", default: 0, description: "Base address for instruction addresses (hex)" },
      },
      required: ["path", "offset"],
    },
    execute: async (args) => {
      const { path, offset, length = 256, architecture = "x86-64", baseAddress = 0 } = args as {
        path: string; offset: number; length?: number; architecture?: string; baseAddress?: number;
      };

      try {
        const cs = await import("@alexaltea/capstone-js");
        const fs = await import("node:fs");

        const clampedLen = Math.min(length, 4096);
        const buf = Buffer.alloc(clampedLen);
        const fd = fs.openSync(path, "r");
        const bytesRead = fs.readSync(fd, buf, 0, clampedLen, offset);
        fs.closeSync(fd);

        const archMap: Record<string, [number, number]> = {
          "x86-16": [cs.CS_ARCH_X86, cs.CS_MODE_16],
          "x86-32": [cs.CS_ARCH_X86, cs.CS_MODE_32],
          "x86-64": [cs.CS_ARCH_X86, cs.CS_MODE_64],
          "arm-32": [cs.CS_ARCH_ARM, cs.CS_MODE_ARM],
          "arm-thumb": [cs.CS_ARCH_ARM, cs.CS_MODE_THUMB],
        };

        const [arch, mode] = archMap[architecture] ?? [cs.CS_ARCH_X86, cs.CS_MODE_64];
        const capstone = new cs.Capstone(arch, mode);

        try {
          const instructions = capstone.disasm(buf.subarray(0, bytesRead), baseAddress);
          return instructions.map((insn: any) => ({
            address: `0x${insn.address.toString(16)}`,
            mnemonic: insn.mnemonic,
            opStr: insn.op_str,
            size: insn.size,
          }));
        } finally {
          capstone.close();
        }
      } catch (err: unknown) {
        const msg = (err as Error)?.message ?? String(err);
        if (msg.includes("Cannot find module") || msg.includes("capstone")) {
          return { error: "disassemble tool requires @alexaltea/capstone-js. Install with: pnpm add -D @alexaltea/capstone-js" };
        }
        return { error: `Disassembly failed: ${msg}` };
      }
    },
  };
}
