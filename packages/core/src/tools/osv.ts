/**
 * OSV (Open Source Vulnerabilities) scanner for MCP npm packages.
 * Checks npx/npm commands against the OSV API before spawning subprocesses.
 */

import { isUrlSafe } from "./security.js";

const OSV_API = "https://api.osv.dev/v1/query";

interface OsvVulnerability {
  id: string;
  summary: string;
  severity?: string;
  database_specific?: { severity?: string };
}

/** Extract npm package name from command + args */
function extractNpmPackage(command: string, args?: string[]): string | null {
  const cmd = command.toLowerCase();

  // npx -y package@version or npx @scope/package
  if (cmd === "npx" && args && args.length > 0) {
    let pkg = args[0];
    // Strip version tag
    pkg = pkg.replace(/@[\d.]+$/, "");
    // Strip -y flag if it's the first arg
    if (pkg === "-y" && args.length > 1) {
      pkg = args[1].replace(/@[\d.]+$/, "");
    }
    return pkg || null;
  }

  // npm install package
  if (cmd === "npm" && args) {
    const installIdx = args.indexOf("install");
    if (installIdx >= 0 && args.length > installIdx + 1) {
      return args[installIdx + 1].replace(/@[\d.]+$/, "");
    }
  }

  return null;
}

/** Query OSV API for known vulnerabilities */
async function queryOsv(packageName: string): Promise<OsvVulnerability[]> {
  try {
    const urlCheck = isUrlSafe(OSV_API);
    if (!urlCheck.safe) return [];

    const resp = await fetch(OSV_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        package: { name: packageName, ecosystem: "npm" },
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) return [];

    const data = await resp.json() as { vulns?: OsvVulnerability[] };
    return data.vulns ?? [];
  } catch {
    return [];
  }
}

export interface OsvScanResult {
  package: string;
  safe: boolean;
  vulnerabilities: Array<{ id: string; summary: string; severity?: string }>;
}

/** Scan an MCP server command for npm package vulnerabilities */
export async function scanMcpCommandForOsv(
  command: string,
  args?: string[],
): Promise<OsvScanResult> {
  const pkg = extractNpmPackage(command, args);
  if (!pkg) {
    return { package: "", safe: true, vulnerabilities: [] };
  }

  const vulns = await queryOsv(pkg);

  // Filter to only HIGH/CRITICAL severity
  const severe = vulns.filter((v) => {
    const sev = v.severity ?? v.database_specific?.severity ?? "";
    return sev.toUpperCase().includes("HIGH") || sev.toUpperCase().includes("CRITICAL");
  });

  return {
    package: pkg,
    safe: severe.length === 0,
    vulnerabilities: severe.map((v) => ({
      id: v.id,
      summary: (v.summary ?? "").slice(0, 200),
      severity: v.severity ?? v.database_specific?.severity,
    })),
  };
}
