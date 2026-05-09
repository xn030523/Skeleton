import type { ToolDef } from "../types.js";
import { cdpSupervisor } from "./browser-supervisor.js";

export function browserDialogTool(): ToolDef {
  return {
    name: "browser_dialog",
    description:
      "Accept, dismiss, or list JavaScript dialogs (alert/confirm/prompt/beforeunload) detected via CDP. " +
      "Requires CDP connection via /browser connect first.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["accept", "dismiss", "list"],
          description: "Accept, dismiss, or list pending JS dialogs",
        },
        promptText: {
          type: "string",
          description: "Text to enter for prompt() dialogs (only with action=accept)",
        },
      },
      required: ["action"],
    },
    execute: async (args) => {
      const { action, promptText } = args as {
        action: string;
        promptText?: string;
      };

      if (!cdpSupervisor.isConnected()) {
        return { error: "CDP not connected. Use /browser connect first." };
      }

      if (action === "list") {
        const dialogs = cdpSupervisor.getPendingDialogs();
        return {
          count: dialogs.length,
          dialogs: dialogs.map(d => ({ type: d.type, message: d.message, url: d.url })),
        };
      }

      const accept = action === "accept";
      try {
        await cdpSupervisor.send("Page.handleJavaScriptDialog", {
          accept,
          promptText: action === "accept" ? promptText : undefined,
        });
        return { success: true, action: accept ? "accepted" : "dismissed" };
      } catch (err) {
        return { error: `Failed to ${action} dialog: ${(err as Error).message}` };
      }
    },
    toolset: "browser",
  };
}
