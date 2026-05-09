/**
 * Insights Engine — session data analysis for usage insights.
 * Token consumption, cost estimates, tool usage patterns, activity trends.
 */

import chalk from "chalk";
import type { SessionDB } from "../session/index.js";

export interface InsightReport {
  totalSessions: number;
  totalMessages: number;
  totalTokens: number;
  totalCost: number;
  topTools: Array<{ name: string; count: number }>;
  topModels: Array<{ model: string; count: number }>;
  dailyActivity: Array<{ date: string; sessions: number; tokens: number }>;
  averageSessionTokens: number;
  averageSessionMessages: number;
  peakDay: { date: string; sessions: number } | null;
}

export class InsightsEngine {
  constructor(private sessionDb: SessionDB) {}

  /** Generate a comprehensive usage insights report */
  generate(days: number = 30): InsightReport {
    const sessions = this.sessionDb.listSessions();
    const cutoff = Date.now() - days * 86400000;
    const recent = sessions.filter(s => s.createdAt > cutoff);

    const toolCounts = new Map<string, number>();
    const modelCounts = new Map<string, number>();
    const dailyMap = new Map<string, { sessions: number; tokens: number; messages: number }>();
    let totalTokens = 0;
    let totalMessages = 0;

    for (const session of recent) {
      totalTokens += session.tokenCount;

      if (session.model) {
        modelCounts.set(session.model, (modelCounts.get(session.model) ?? 0) + 1);
      }

      const date = new Date(session.createdAt).toISOString().slice(0, 10);
      const entry = dailyMap.get(date) ?? { sessions: 0, tokens: 0, messages: 0 };
      entry.sessions++;
      entry.tokens += session.tokenCount;

      // Count tool usage and messages from session
      const msgs = this.sessionDb.getSessionMessages(session.id);
      entry.messages += msgs.length;
      totalMessages += msgs.length;

      for (const msg of msgs) {
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            toolCounts.set(tc.name, (toolCounts.get(tc.name) ?? 0) + 1);
          }
        }
      }

      dailyMap.set(date, entry);
    }

    const topTools = [...toolCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    const topModels = [...modelCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([model, count]) => ({ model, count }));

    const dailyActivity = [...dailyMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, data]) => ({ date, ...data }));

    // Find peak day
    let peakDay: InsightReport["peakDay"] = null;
    for (const [date, data] of dailyMap) {
      if (!peakDay || data.sessions > peakDay.sessions) {
        peakDay = { date, sessions: data.sessions };
      }
    }

    return {
      totalSessions: recent.length,
      totalMessages,
      totalTokens,
      totalCost: 0,
      topTools,
      topModels,
      dailyActivity,
      averageSessionTokens: recent.length > 0 ? Math.floor(totalTokens / recent.length) : 0,
      averageSessionMessages: recent.length > 0 ? Math.floor(totalMessages / recent.length) : 0,
      peakDay,
    };
  }

  /** Format insights as terminal text */
  formatTerminal(report: InsightReport): string {
    const lines: string[] = [
      chalk.cyan("═".repeat(50)),
      chalk.bold.white("  Usage Insights"),
      chalk.cyan("═".repeat(50)),
      "",
      `  Sessions:       ${report.totalSessions}`,
      `  Messages:       ${report.totalMessages.toLocaleString()}`,
      `  Tokens:         ${report.totalTokens.toLocaleString()}`,
      `  Avg Msgs/Sess:  ${report.averageSessionMessages}`,
      `  Avg Tokens/Sess:${report.averageSessionTokens.toLocaleString()}`,
    ];

    if (report.peakDay) {
      lines.push(`  Peak Day:       ${report.peakDay.date} (${report.peakDay.sessions} sessions)`);
    }

    if (report.topTools.length > 0) {
      lines.push("", chalk.yellow("  Top Tools:"));
      for (const t of report.topTools.slice(0, 7)) {
        const bar = "█".repeat(Math.min(20, Math.ceil(t.count / (report.topTools[0]?.count || 1) * 20)));
        lines.push(`    ${t.name.padEnd(20)} ${bar} ${t.count}`);
      }
    }

    if (report.dailyActivity.length > 0) {
      lines.push("", chalk.yellow("  Daily Activity (last 7 days):"));
      const last7 = report.dailyActivity.slice(-7);
      for (const d of last7) {
        const bar = "█".repeat(Math.min(15, Math.ceil(d.sessions / Math.max(...last7.map(x => x.sessions), 1) * 15)));
        lines.push(`    ${d.date} ${bar} ${d.sessions}`);
      }
    }

    lines.push("", chalk.cyan("═".repeat(50)));
    return lines.join("\n");
  }
}
