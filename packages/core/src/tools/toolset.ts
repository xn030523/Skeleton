import type { ToolDef } from "../types.js";
import type { ToolRegistry } from "./registry.js";

export function toolsetManageTool(registry: ToolRegistry): ToolDef {
  return {
    name: "toolset_manage",
    toolset: "system",
    description:
      "Manage toolset groups — list groups, enable/disable toolsets. " +
      "Disabling a toolset hides its tools from the LLM, reducing context usage. " +
      "Enabling restores them. Tools without a toolset are always visible.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["list", "enable", "disable"],
          description: "Action to perform",
        },
        name: {
          type: "string",
          description: "Toolset name (for enable/disable)",
        },
      },
      required: ["action"],
    },
    execute: async (args) => {
      const { action, name } = args as { action: string; name?: string };

      switch (action) {
        case "list":
          return registry.getToolsets();

        case "enable": {
          if (!name) return { error: "Missing 'name' parameter for enable" };
          const found = registry.enableToolset(name);
          return found
            ? { success: true, message: `Toolset "${name}" enabled — tools now visible` }
            : { error: `Toolset "${name}" was not disabled` };
        }

        case "disable": {
          if (!name) return { error: "Missing 'name' parameter for disable" };
          const toolsets = registry.getToolsets();
          const exists = toolsets.some(ts => ts.name === name);
          if (!exists) return { error: `Unknown toolset: ${name}. Use 'list' action to see available toolsets.` };
          registry.disableToolset(name);
          return { success: true, message: `Toolset "${name}" disabled — tools hidden from LLM` };
        }

        default:
          return { error: `Unknown action: ${action}. Supported: list, enable, disable` };
      }
    },
  };
}
