/**
 * Agent Status — runtime status reporting.
 */

import type { Agent } from "./agent.js";

export interface AgentStatusReport {
  model: string;
  provider: string;
  sessionId: string;
  messageCount: number;
  toolCallCount: number;
  contextPercent: number;
  contextUsed: number;
  contextWindow: number;
  voiceMode: string;
  progressMode: string;
  statusBarMode: string;
  goalActive: boolean;
  goalText: string | null;
  goalStatus: string | null;
  hooks: number;
  plugins: number;
  skills: number;
  uptime: string;
}

export function getAgentStatus(agent: Agent): AgentStatusReport {
  const ctx = agent.getContextProgress();
  const goal = agent.getGoal();
  const history = agent.getHistory();

  return {
    model: ctx.model ?? "unknown",
    provider: agent["transport"]?.getConfig?.()?.baseUrl ?? "unknown",
    sessionId: agent["sessionId"] ?? "unknown",
    messageCount: history.length,
    toolCallCount: agent["toolCallCount"] ?? 0,
    contextPercent: ctx.percent,
    contextUsed: ctx.usedTokens,
    contextWindow: ctx.contextWindow,
    voiceMode: agent.voiceMode,
    progressMode: agent.progressMode,
    statusBarMode: agent.statusBarMode,
    goalActive: !!goal && goal.status === "active",
    goalText: goal?.goal ?? null,
    goalStatus: goal?.status ?? null,
    hooks: agent.hooks.list().length,
    plugins: agent.pluginSystem.listLoaded().length,
    skills: agent.getSkillRegistry().list().length,
    uptime: formatUptime(process.uptime()),
  };
}

export function formatAgentStatus(report: AgentStatusReport): string {
  const lines = [
    `  Model:      ${report.model}`,
    `  Provider:  ${report.provider}`,
    `  Session:    ${report.sessionId}`,
    `  Messages:   ${report.messageCount}`,
    `  Tool Calls: ${report.toolCallCount}`,
    `  Context:    ${report.contextPercent}% (${report.contextUsed}/${report.contextWindow})`,
    `  Voice:      ${report.voiceMode}`,
    `  Progress:   ${report.progressMode}`,
    `  Status Bar: ${report.statusBarMode}`,
    `  Hooks:      ${report.hooks}`,
    `  Plugins:    ${report.plugins}`,
    `  Skills:     ${report.skills}`,
    `  Uptime:     ${report.uptime}`,
  ];

  if (report.goalActive) {
    lines.push(`  Goal:       ${report.goalText} (${report.goalStatus})`);
  }

  return lines.join("\n");
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
