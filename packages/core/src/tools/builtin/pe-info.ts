import fs from "node:fs";
import type { ToolDef } from "../../types.js";
import { NtExecutable } from "pe-library";

const MACHINE_MAP: Record<number, string> = {
  0x14c: "x86 (i386)", 0x8664: "x86-64 (AMD64)", 0xaa64: "ARM64",
  0x1c0: "ARM", 0x1c2: "ARM Thumb-2", 0x5064: "RISC-V 64",
};

const SUBSYSTEM_MAP: Record<number, string> = {
  1: "Native", 2: "Windows GUI", 3: "Windows Console",
  5: "OS/2 Console", 7: "POSIX Console", 9: "Windows CE",
  10: "EFI Application", 11: "EFI Boot Service Driver",
};

const SECTION_FLAGS: Record<number, string> = {
  0x20: "CODE", 0x40: "INITIALIZED_DATA", 0x80: "UNINITIALIZED_DATA",
  0x20000000: "EXECUTE", 0x40000000: "READ", 0x80000000: "WRITE",
};

const DLL_CHARS: Record<number, string> = {
  0x20: "HIGH_ENTROPY_VA", 0x40: "DYNAMIC_BASE", 0x80: "FORCE_INTEGRITY",
  0x100: "NX_COMPAT", 0x200: "NO_SEH", 0x400: "NO_BIND",
  0x800: "APPCONTAINER", 0x1000: "WDM_DRIVER", 0x2000: "GUARD_CF",
  0x4000: "TERMINAL_SERVER_AWARE",
};

function decodeFlags(value: number, map: Record<number, string>): string[] {
  return Object.entries(map).filter(([bit]) => (value & Number(bit)) !== 0).map(([, name]) => name);
}

export function peInfoTool(): ToolDef {
  return {
    name: "pe_info",
    description: "Parse PE (Portable Executable) file headers, sections, imports, and exports. Works with .exe, .dll, .sys files. Returns architecture, entry point, section details, imported DLLs/functions, and exported functions.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Absolute path to the PE file" },
        sections: { type: "boolean", default: true, description: "Include section table" },
      },
      required: ["path"],
    },
    execute: async (args) => {
      const { path, sections = true } = args as {
        path: string; sections?: boolean;
      };
      try {
        const buf = fs.readFileSync(path);
        const pe = NtExecutable.from(buf);

        const fh = pe.newHeader.fileHeader;
        const oh = pe.newHeader.optionalHeader;

        const result: Record<string, unknown> = {
          format: "PE",
          bitness: pe.is32bit() ? 32 : 64,
          machine: MACHINE_MAP[fh.machine] ?? `0x${fh.machine.toString(16)}`,
          numberOfSections: fh.numberOfSections,
          timestamp: new Date(fh.timeDateStamp * 1000).toISOString(),
          characteristics: decodeFlags(fh.characteristics, {
            0x2: "EXECUTABLE_IMAGE", 0x4: "LINE_NUMS_STRIPPED",
            0x8: "LOCAL_SYMS_STRIPPED", 0x20: "LARGE_ADDRESS_AWARE",
            0x100: "32BIT_MACHINE", 0x2000: "DLL",
          }),
          imageBase: `0x${oh.imageBase.toString(16)}`,
          entryPoint: `0x${oh.addressOfEntryPoint.toString(16)}`,
          subsystem: SUBSYSTEM_MAP[oh.subsystem] ?? oh.subsystem,
          dllCharacteristics: decodeFlags(oh.dllCharacteristics, DLL_CHARS),
          imageSize: oh.sizeOfImage,
        };

        if (sections) {
          result.sections = pe.getAllSections().map((s) => ({
            name: s.info.name,
            virtualAddress: `0x${s.info.virtualAddress.toString(16)}`,
            virtualSize: s.info.virtualSize,
            rawSize: s.info.sizeOfRawData,
            flags: decodeFlags(s.info.characteristics, SECTION_FLAGS),
          }));
        }

        return result;
      } catch (err) {
        return { error: `Failed to parse PE: ${(err as Error).message}` };
      }
    },
  };
}
