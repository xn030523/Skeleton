import fs from "node:fs";
import type { ToolDef } from "../../types.js";
import { ELF } from "elf-tools";

const MACHINE_MAP: Record<string, string> = {
  "0x03": "x86", "0x3e": "x86-64", "0xb7": "AArch64",
  "0x28": "ARM", "0xf3": "RISC-V", "0x08": "MIPS",
  "0x2a": "MIPS64", "0x32": "IA-64", "0x15": "PA-RISC",
};

const TYPE_MAP: Record<string, string> = {
  "0x02": "executable", "0x03": "shared object",
  "0x01": "relocatable", "0x04": "core",
};

const SEGMENT_TYPE_MAP: Record<string, string> = {
  "0x00": "NULL", "0x01": "LOAD", "0x02": "DYNAMIC",
  "0x03": "INTERP", "0x04": "NOTE", "0x06": "PHDR",
  "0x07": "TLS", "0x6474e550": "GNU_EH_FRAME",
  "0x6474e551": "GNU_STACK", "0x6474e552": "GNU_RELRO",
};

const SEGMENT_FLAGS: Record<string, string> = {
  "0x4": "R", "0x5": "RX", "0x6": "RW", "0x7": "RWX",
};

export function elfInfoTool(): ToolDef {
  return {
    name: "elf_info",
    description: "Parse ELF (Executable and Linkable Format) file headers, sections, and program segments. Works with executables, shared objects (.so), and object files (.o). Returns class, endianness, machine type, entry point, section details, and segment details.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the ELF file" },
        sections: { type: "boolean", default: true, description: "Include section table" },
        segments: { type: "boolean", default: true, description: "Include program header / segment table" },
      },
      required: ["path"],
    },
    execute: async (args) => {
      const { path, sections = true, segments = true } = args as {
        path: string; sections?: boolean; segments?: boolean;
      };
      try {
        const buf = fs.readFileSync(path);
        const elf = ELF.parse(buf);

        if (!elf) return { error: "Failed to parse ELF file — may not be a valid ELF" };

        const hdr = elf.header;
        const result: Record<string, unknown> = {
          format: "ELF",
          class: hdr.ei_class === 2 ? "64-bit" : "32-bit",
          endianness: hdr.ei_data === 2 ? "big" : "little",
          type: TYPE_MAP[hdr.e_type] ?? hdr.e_type,
          machine: MACHINE_MAP[hdr.e_machine] ?? hdr.e_machine,
          entryPoint: `0x${hdr.e_entry.toString(16)}`,
          flags: hdr.e_flags,
        };

        if (segments && elf.program_headers) {
          result.segments = elf.program_headers.map((p) => ({
            type: SEGMENT_TYPE_MAP[p.p_type] ?? p.p_type,
            flags: SEGMENT_FLAGS[p.p_flags] ?? p.p_flags,
            offset: `0x${p.p_offset.toString(16)}`,
            vaddr: `0x${p.p_vaddr.toString(16)}`,
            filesz: p.p_filesz,
            memsz: p.p_memsz,
          }));
        }

        if (sections && elf.section_headers) {
          result.sections = elf.section_headers.map((s) => ({
            name: s.sh_name_str ?? s.sh_name,
            type: s.sh_type,
            flags: s.sh_flags,
            address: `0x${s.sh_addr.toString(16)}`,
            offset: `0x${s.sh_offset.toString(16)}`,
            size: s.sh_size,
          }));
        }

        return result;
      } catch (err) {
        return { error: `Failed to parse ELF: ${(err as Error).message}` };
      }
    },
  };
}
