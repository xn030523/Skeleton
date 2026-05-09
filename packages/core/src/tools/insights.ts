/**
 * Insights Engine — session data analysis for usage insights.
 * Token consumption, cost estimates, tool usage patterns, activity trends.
 *
 * Inspired by Hermes insights.py.
 */

import type { SessionDB } from "../session/index.js";

export interface InsightReport {
  totalSessions: number;
  totalTokens: number;
  totalCost: number;
  topTools: Array<{ name: string; count: number }>;
  topModels: Array<{ model: string; count: number }>;
  dailyActivity: Array<{ date: string; sessions: number; tokens: number }>;
  averageSessionTokens: number;
  averageSessionDuration: number;
}

export class InsightsEngine {
  constructor(private sessionDb: SessionDB) {}

  /** Generate a comprehensive usage insights report */
  generate(days: number = 30): InsightReport {
    const sessions = this.sessionDb.listSessions();
    const cutoff = Date.now() - days * 86400000;
    const recent = sessions.filter(s => (s.createdAt ?? 0) > cutoff);

    const toolCounts = new Map<string, number>();
    const modelCounts = new Map<string, number>();
    const dailyMap = new Map<string, { sessions: number; tokens: number }>();
    let totalTokens = 0;

    for (const session of recent) {
      totalTokens += session.tokenCount ?? 0;
      if (session.model) modelCounts.set(session.model, (modelCounts.get(session.model) ?? 0) + 1);

      const date = new Date(session.createdAt ?? 0).toISOString().slice(0, 10);
      const entry = dailyMap.get(date) ?? { sessions: 0, tokens: 0 };
      entry.sessions++;
      entry.tokens += session.tokenCount ?? 0;
      dailyMap.set(date, entry);

      // Count tool usage from messages
      const msgs = this.sessionDb.getSessionMessages(session.id);
      for (const msg of msgs) {
        if (msg.toolCalls) {
          for (const tc of msg.toolCalls) {
            toolCounts.set(tc.name, (toolCounts.get(tc.name) ?? 0) + 1);
          }
        }
      }
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

    return {
      totalSessions: recent.length,
      totalTokens,
      totalCost: 0, // Would need pricing integration
      topTools,
      topModels,
      dailyActivity,
      averageSessionTokens: recent.length > 0 ? Math.floor(totalTokens / recent.length) : 0,
      averageSessionDuration: 0,
    };
  }

  /** Format insights as terminal text */
  formatTerminal(report: InsightReport): string {
    return [
      `== Usage Insights (Last 30 days) ==`,
      `Sessions: ${report.totalSessions}`,
      `Total Tokens: ${report.totalTokens.toLocaleString()}`,
      `Avg Tokens/Session: ${report.averageSessionTokens.toLocaleString()}`,
      ``,
      `Top Tools:`,
      ...report.topTools.map(t => `  ${t.name}: ${t.count}`),
      ``,
      `Top Models:`,
      ...report.topModels.map(m => `  ${m.model}: ${m.count}`),
    ].join("\n");
  }
}
