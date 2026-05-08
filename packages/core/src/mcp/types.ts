import type { McpServerConfig } from "../config/index.js";

export interface BuiltinMcpServer {
  name: string;
  description: string;
  category: McpCategory;
  config: McpServerConfig;
  envEnable: string;
  requiredEnv?: string[];
  optionalEnv?: string[];
  platform?: NodeJS.Platform[];
}

export type McpCategory =
  | "static-analysis"
  | "dynamic-analysis"
  | "malware"
  | "security-audit"
  | "blockchain"
  | "cloud"
  | "forensics"
  | "osint"
  | "browser"
  | "web-reverse";

export const MCP_CATEGORIES: Record<McpCategory, string> = {
  "static-analysis": "Static Analysis & Disassembly",
  "dynamic-analysis": "Dynamic Analysis & Debugging",
  malware: "Malware & Threat Analysis",
  "security-audit": "Security Audit & Pentesting",
  blockchain: "Blockchain Security",
  cloud: "Cloud Security",
  forensics: "Digital Forensics",
  osint: "Open-Source Intelligence",
  browser: "Browser Instrumentation",
  "web-reverse": "Web Reverse Engineering",
};
