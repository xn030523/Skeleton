/**
 * Debug Report — collect diagnostics for troubleshooting.
 */

import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import type { Agent } from "./agent.js";

export interface DebugReport {
  timestamp: string;
  platform: string;
  nodeVersion: string;
  skeletonVersion: string;
  provider: string;
  model: string;
  messages: number;
  tools: number;
  hooks: number;
  plugins: number;
  skills: number;
  contextPercent: number;
  voiceMode: string;
  progressMode: string;
  statusBarMode: string;
  errors: string[];
  envHints: string[];
}

export function generateDebugReport(agent: Agent): DebugReport {
  const ctx = agent.getContextProgress();
  const toolRegistry = agent.getToolRegistry();
  const skillRegistry = agent.getSkillRegistry();
  const history = agent.getHistory();

  return {
    timestamp: new Date().toISOString(),
    platform: `${os.type()} ${os.release()} ${os.arch()}`,
    nodeVersion: process.version,
    skeletonVersion: "0.1.0",
    provider: agent["transport"]?.getConfig?.()?.baseUrl ?? "unknown",
    model: ctx.model ?? "unknown",
    messages: history.length,
    tools: toolRegistry.list().length,
    hooks: agent.hooks.list().length,
    plugins: agent.pluginSystem.listLoaded().length,
    skills: skillRegistry.list().length,
    contextPercent: ctx.percent,
    voiceMode: agent.voiceMode,
    progressMode: agent.progressMode,
    statusBarMode: agent.statusBarMode,
    errors: [],
    envHints: collectEnvHints(),
  };
}

export function formatDebugReport(report: DebugReport): string {
  return [
    `Skeleton Debug Report — ${report.timestamp}`,
    `════════════════════════════════════════`,
    ``,
    `Platform:      ${report.platform}`,
    `Node:          ${report.nodeVersion}`,
    `Version:       ${report.skeletonVersion}`,
    ``,
    `Provider:      ${report.provider}`,
    `Model:         ${report.model}`,
    `Context:       ${report.contextPercent}%`,
    ``,
    `Messages:      ${report.messages}`,
    `Tools:         ${report.tools}`,
    `Hooks:         ${report.hooks}`,
    `Plugins:       ${report.plugins}`,
    `Skills:        ${report.skills}`,
    ``,
    `Voice:         ${report.voiceMode}`,
    `Progress:      ${report.progressMode}`,
    `Status Bar:    ${report.statusBarMode}`,
    ``,
    ...report.envHints.map(h => `Env Hint: ${h}`),
    `════════════════════════════════════════`,
  ].join("\n");
}

export function saveDebugReport(report: DebugReport, filePath?: string): string {
  const outputPath = filePath ?? path.join(os.homedir(), ".skeleton", `debug-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf-8");
  return outputPath;
}

function collectEnvHints(): string[] {
  const hints: string[] = [];
  if (!process.env.SKELETON_API_KEY && !process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    hints.push("No API key detected — set SKELETON_API_KEY or a provider-specific key");
  }
  if (!process.env.SKELETON_PROVIDER) {
    hints.push("SKELETON_PROVIDER not set — using default protocol");
  }
  return hints;
}
