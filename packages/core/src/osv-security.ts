/**
 * OSV Security Check — scan npm packages for known vulnerabilities.
 */

import { execSync } from "node:child_process";

export interface VulnerabilityReport {
  package: string;
  version: string;
  vulnerabilities: Array<{
    id: string;
    summary: string;
    severity: string;
    url: string;
  }>;
}

export async function checkPackageSecurity(packageName: string): Promise<VulnerabilityReport> {
  const report: VulnerabilityReport = {
    package: packageName,
    version: "unknown",
    vulnerabilities: [],
  };

  // Try npm audit for local packages
  try {
    const result = execSync(`npm audit --json --package=${packageName} 2>/dev/null || echo "{}"`, {
      encoding: "utf-8",
      timeout: 30000,
    });
    const audit = JSON.parse(result);
    if (audit.vulnerabilities) {
      for (const [, v] of Object.entries(audit.vulnerabilities as Record<string, unknown>)) {
        const vuln = v as Record<string, unknown>;
        report.vulnerabilities.push({
          id: String(vuln.id ?? "unknown"),
          summary: String(vuln.title ?? vuln.advisory ?? ""),
          severity: String(vuln.severity ?? "unknown"),
          url: String(vuln.url ?? ""),
        });
      }
    }
  } catch { /* npm audit not available or package not found */ }

  // Try OSV API
  try {
    const resp = await fetch("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ package: { name: packageName, ecosystem: "npm" } }),
    });
    if (resp.ok) {
      const data = await resp.json() as { vulns?: Array<Record<string, unknown>> };
      if (data.vulns) {
        for (const v of data.vulns) {
          report.vulnerabilities.push({
            id: String(v.id ?? "unknown"),
            summary: String(v.summary ?? ""),
            severity: String((v.database_specific as Record<string, unknown>)?.severity ?? "unknown"),
            url: String(v.references?.[0]?.url ?? `https://osv.dev/vulnerability/${v.id}`),
          });
        }
      }
    }
  } catch { /* OSV API unavailable */ }

  return report;
}

export function formatVulnerabilityReport(report: VulnerabilityReport): string {
  if (report.vulnerabilities.length === 0) {
    return `  ${report.package}: No known vulnerabilities ✓`;
  }

  const lines = [`  ${report.package}: ${report.vulnerabilities.length} vulnerability(ies)`];
  for (const v of report.vulnerabilities.slice(0, 10)) {
    const severity = v.severity === "critical" || v.severity === "high" ? "⚠️" : "ℹ️";
    lines.push(`    ${severity} ${v.id}: ${v.summary.slice(0, 80)}`);
    if (v.url) lines.push(`       ${v.url}`);
  }
  return lines.join("\n");
}
