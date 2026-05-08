import type { ToolDef } from "../../types.js";
import { identifyTool } from "./identify.js";
import { hexdumpTool } from "./hexdump.js";
import { stringsTool } from "./strings.js";
import { peInfoTool } from "./pe-info.js";
import { elfInfoTool } from "./elf-info.js";
import { entropyTool } from "./entropy.js";
import { disassembleTool } from "./disassemble.js";

export function builtInTools(): ToolDef[] {
  return [
    identifyTool(),
    hexdumpTool(),
    stringsTool(),
    peInfoTool(),
    elfInfoTool(),
    entropyTool(),
    disassembleTool(),
  ];
}
