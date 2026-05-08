import fs from "node:fs";
import type { ToolDef } from "../../types.js";

const MAGIC_TABLE: Array<{ bytes: number[]; mask?: number[]; format: string; arch?: string; bits?: number; mime?: string }> = [
  { bytes: [0x7f, 0x45, 0x4c, 0x46], format: "ELF", mime: "application/x-elf" },
  { bytes: [0x4d, 0x5a], format: "PE", mime: "application/x-dosexec" },
  { bytes: [0xfe, 0xed, 0xfa, 0xce], format: "Mach-O", arch: "ARM/PPC", bits: 32, mime: "application/x-mach-o" },
  { bytes: [0xfe, 0xed, 0xfa, 0xcf], format: "Mach-O", arch: "ARM64/PPC64", bits: 64, mime: "application/x-mach-o" },
  { bytes: [0xce, 0xfa, 0xed, 0xfe], format: "Mach-O", arch: "x86", bits: 32, mime: "application/x-mach-o" },
  { bytes: [0xcf, 0xfa, 0xed, 0xfe], format: "Mach-O", arch: "x86-64", bits: 64, mime: "application/x-mach-o" },
  { bytes: [0xca, 0xfe, 0xba, 0xbe], format: "Java Class", mime: "application/java-vm" },
  { bytes: [0x64, 0x65, 0x78], format: "DEX (Android Dalvik)", mime: "application/vnd.android.dex" },
  { bytes: [0x50, 0x4b, 0x03, 0x04], format: "ZIP", mime: "application/zip" },
  { bytes: [0x25, 0x50, 0x44, 0x46], format: "PDF", mime: "application/pdf" },
  { bytes: [0x89, 0x50, 0x4e, 0x47], format: "PNG", mime: "image/png" },
  { bytes: [0xff, 0xd8, 0xff], format: "JPEG", mime: "image/jpeg" },
  { bytes: [0x47, 0x49, 0x46], format: "GIF", mime: "image/gif" },
  { bytes: [0x52, 0x49, 0x46, 0x46], format: "RIFF", mime: "application/x-riff" },
  { bytes: [0x37, 0x7a, 0xbc, 0xaf], format: "7z", mime: "application/x-7z-compressed" },
  { bytes: [0x1f, 0x8b], format: "GZIP", mime: "application/gzip" },
  { bytes: [0x42, 0x5a, 0x68], format: "BZIP2", mime: "application/x-bzip2" },
  { bytes: [0xfd, 0x37, 0x7a, 0x58, 0x5a], format: "XZ", mime: "application/x-xz" },
  { bytes: [0x01, 0x00], format: "COFF i386", arch: "x86", bits: 32 },
  { bytes: [0x50, 0x00], format: "COFF AMD64", arch: "x86-64", bits: 64 },
  { bytes: [0x64, 0x86], format: "COFF ARM64", arch: "ARM64", bits: 64 },
];

export function identifyTool(): ToolDef {
  return {
    name: "identify",
    description: "Identify the file type of a binary by checking magic bytes and header signatures. Returns format, architecture, and class (32/64-bit) where detectable.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the file" },
      },
      required: ["path"],
    },
    execute: async (args) => {
      const { path } = args as { path: string };
      try {
        const stat = fs.statSync(path);
        const buf = fs.readFileSync(path).subarray(0, 64);

        // ELF detail extraction
        if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
          const bits = buf[4] === 2 ? 64 : 32;
          const endian = buf[5] === 2 ? "big" : "little";
          const machineMap: Record<number, string> = { 0x03: "x86", 0x3e: "x86-64", 0xb7: "AArch64", 0xf3: "RISC-V", 0x28: "ARM" };
          const typeMap: Record<number, string> = { 2: "executable", 3: "shared object", 1: "relocatable", 4: "core" };
          const eType = endian === "little" ? buf.readUInt16LE(16) : buf.readUInt16BE(16);
          const eMachine = endian === "little" ? buf.readUInt16LE(18) : buf.readUInt16BE(18);
          return { format: "ELF", bits, endianness: endian, type: typeMap[eType] ?? eType, arch: machineMap[eMachine] ?? `0x${eMachine.toString(16)}`, size: stat.size, mime: "application/x-elf" };
        }

        // PE detail extraction
        if (buf[0] === 0x4d && buf[1] === 0x5a) {
          const e_lfanew = buf.readUInt32LE(0x3c);
          if (e_lfanew + 6 < buf.length && buf.readUInt32LE(e_lfanew) === 0x00004550) {
            const machine = buf.readUInt16LE(e_lfanew + 4);
            const machineMap: Record<number, string> = { 0x14c: "x86", 0x8664: "x86-64", 0xaa64: "ARM64" };
            return { format: "PE", bits: machine === 0x14c ? 32 : 64, arch: machineMap[machine] ?? `0x${machine.toString(16)}`, size: stat.size, mime: "application/x-dosexec" };
          }
          return { format: "PE (DOS)", size: stat.size, mime: "application/x-dosexec" };
        }

        // Generic magic match
        for (const entry of MAGIC_TABLE) {
          let match = true;
          for (let i = 0; i < entry.bytes.length; i++) {
            const mask = entry.mask?.[i] ?? 0xff;
            if ((buf[i] & mask) !== (entry.bytes[i] & mask)) { match = false; break; }
          }
          if (match) return { format: entry.format, arch: entry.arch, bits: entry.bits, size: stat.size, mime: entry.mime };
        }

        return { format: "unknown", size: stat.size, firstBytes: Array.from(buf.slice(0, 16)).map((b) => b.toString(16).padStart(2, "0")).join(" ") };
      } catch (err) {
        return { error: `Failed to read file: ${(err as Error).message}` };
      }
    },
  };
}
