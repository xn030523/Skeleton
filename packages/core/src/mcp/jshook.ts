import type { McpServerConfig } from "../../config/index.js";

export interface BuiltinMcpServer {
  name: string;
  description: string;
  config: McpServerConfig;
  envDisable: string;
}

export const jshookServer: BuiltinMcpServer = {
  name: "jshook",
  description: "Browser instrumentation: 387 tools across 36 domains (debugger, hooks, memory, wasm, v8-inspector, network, trace, etc.). Run via npx.",
  config: {
    command: "npx",
    args: ["-y", "@jshookmcp/jshook@latest"],
    env: { JSHOOK_BASE_PROFILE: "search" },
  },
  envDisable: "SKELETON_JSHOOK",
};
