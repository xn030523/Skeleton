/**
 * MCP Security — OSV malware check for MCP packages before launching via npx/uvx.
 *
 * Queries the Open Source Vulnerabilities API for MAL-* advisories.
 * Only blocks on confirmed malware (MAL- prefix), ignoring regular CVEs.
 * Fail-open on network errors so connectivity issues don't block workflow.
 */

interface MalwareCheckResult {
  safe: boolean;
  advisories?: string[];
}

const OSV_API = "https://api.osv.dev/v1/query";

const SUPPORTED_ECOSYSTEMS = ["npm", "PyPI"];

/** Check an MCP package for confirmed malware advisories via OSV */
export async function checkPackageForMalware(
  packageName: string,
  version?: string,
): Promise<MalwareCheckResult> {
  const ecosystem = detectEcosystem(packageName);

  try {
    const body: Record<string, unknown> = {
      package: { name: packageName, ecosystem },
    };
    if (version) {
      body.version = version;
    }

    const resp = await fetch(OSV_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });

    if (!resp.ok) {
      return { safe: true };
    }

    const data = await resp.json() as { vulns?: Array<{ id: string }> };
    const vulns = data.vulns ?? [];

    const malwareAdvisories = vulns
      .filter((v) => v.id.startsWith("MAL-"))
      .map((v) => v.id);

    if (malwareAdvisories.length === 0) {
      return { safe: true };
    }

    return {
      safe: false,
      advisories: malwareAdvisories,
    };
  } catch {
    return { safe: true };
  }
}

function detectEcosystem(packageName: string): string {
  if (packageName.startsWith("@")) return "npm";
  if (packageName.includes("-") || packageName.includes("_")) {
    return "npm";
  }
  return "npm";
}
