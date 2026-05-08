import type { ToolDef } from "../../types.js";
import { identifyTool } from "./identify.js";
import { hexdumpTool } from "./hexdump.js";
import { stringsTool } from "./strings.js";
import { peInfoTool } from "./pe-info.js";
import { elfInfoTool } from "./elf-info.js";
import { entropyTool } from "./entropy.js";
import { disassembleTool } from "./disassemble.js";
import { webSearchTool } from "./web-search.js";
import { webFetchTool } from "./web-fetch.js";
import { terminalTool } from "./terminal.js";
import { browserTool } from "./browser.js";

export function builtInTools(): ToolDef[] {
  const tools: ToolDef[] = [
    identifyTool(),
    hexdumpTool(),
    stringsTool(),
    peInfoTool(),
    elfInfoTool(),
    entropyTool(),
    disassembleTool(),
    webSearchTool(),
    webFetchTool(),
    terminalTool(),
    browserTool(),
  ];

  const toolsetMap: Record<string, string> = {
    identify: "re", hexdump: "re", strings: "re", pe_info: "re", elf_info: "re",
    entropy: "re", disassemble: "re",
    web_search: "web", web_fetch: "web",
    terminal: "system", browser: "browser",
  };

  const emojiMap: Record<string, string> = {
    identify: "🔍", hexdump: "📐", strings: "📝", pe_info: "🪟", elf_info: "🐧",
    entropy: "📊", disassemble: "⚙️",
    web_search: "🌐", web_fetch: "📄",
    terminal: "💻", browser: "🌍",
  };

  for (const t of tools) {
    if (toolsetMap[t.name]) {
      (t as { toolset?: string }).toolset = toolsetMap[t.name];
    }
    if (emojiMap[t.name]) {
      (t as { emoji?: string }).emoji = emojiMap[t.name];
    }
  }

  for (const t of tools) {
    if (toolsetMap[t.name]) {
      (t as { toolset?: string }).toolset = toolsetMap[t.name];
    }
  }

  return tools;
}
