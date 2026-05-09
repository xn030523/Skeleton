/**
 * Command resolution — Node.js equivalent of Python's shutil.which().
 *
 * Before spawning an MCP subprocess, check if the command actually exists
 * on the system. If not found, skip gracefully with a helpful install hint
 * instead of letting the spawn crash.
 *
 * Hermes uses shutil.which(command, path=path_arg) for the same purpose.
 */

import { execSync } from "node:child_process";

const CHECK_TIMEOUT_MS = 5000;

// ─── Cache ─────────────────────────────────────────────────────────────────────

const cache = new Map<string, string | null>();

// ─── Install hints for common commands ─────────────────────────────────────────

const INSTALL_HINTS: Record<string, string> = {
  docker: "Install Docker Desktop: https://docs.docker.com/get-docker/",
  uvx: "Install uv: pip install uv  OR  pipx install uv  OR  https://docs.astral.sh/uv/",
  r2pm: "Install radare2: https://radare.org/  OR  brew install radare2  OR  choco install radare2",
  npx: "npx ships with Node.js (npm): https://nodejs.org/",
  npm: "npm ships with Node.js: https://nodejs.org/",
  node: "Install Node.js: https://nodejs.org/",
  python3: "Install Python 3: https://python.org/  OR  brew install python3",
  python: "Install Python: https://python.org/",
  ida_mcp: "Install ida-mcp-rs: https://github.com/blacktop/ida-mcp-rs",
  frida_mcp: "Install frida-mcp: pip install frida-mcp  OR  pipx install frida-mcp",
  nexuscore_mcp: "Install nexuscore: https://github.com/nexusseet/nexuscore-mcp",
  flowlens_mcp_server: "Install FlowLens: https://github.com/FlowLens/flowlens-mcp",
  mitmdump: "Install mitmproxy: pip install mitmproxy  OR  brew install mitmproxy",
  "ida-mcp": "Install ida-mcp-rs: https://github.com/blacktop/ida-mcp-rs",
  "frida-mcp": "Install frida-mcp: pip install frida-mcp  OR  pipx install frida-mcp",
};

function getInstallHint(command: string): string | null {
  // Direct match first
  if (INSTALL_HINTS[command]) return INSTALL_HINTS[command];
  // Prefix match (e.g., "frida-mcp" matches "frida")
  const base = command.split("-")[0];
  if (INSTALL_HINTS[base]) return INSTALL_HINTS[base];
  return null;
}

// ─── Core resolution ───────────────────────────────────────────────────────────

/**
 * Resolve a command to its full path — equivalent of Python's shutil.which().
 *
 * Uses platform-native resolution:
 *   - Windows: `where <command>`
 *   - Unix: `which <command>`
 *
 * Returns the resolved path, or null if not found.
 */
export function resolveCommand(command: string): string | null {
  if (cache.has(command)) return cache.get(command) ?? null;

  let result: string | null = null;

  try {
    if (process.platform === "win32") {
      // `where` is built-in on Windows, handles .exe/.cmd/.bat resolution
      const raw = execSync(`where ${command}`, {
        timeout: CHECK_TIMEOUT_MS,
        encoding: "utf-8",
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      result = raw.split(/\r?\n/)[0].trim() || null;
    } else {
      const raw = execSync(`which ${command}`, {
        timeout: CHECK_TIMEOUT_MS,
        encoding: "utf-8",
      }).trim();
      result = raw || null;
    }
  } catch {
    result = null;
  }

  cache.set(command, result);
  return result;
}

/**
 * Boolean check for command availability.
 */
export function isCommandAvailable(command: string): boolean {
  return resolveCommand(command) !== null;
}

/**
 * Check command availability and return a structured result with install hints.
 */
export function checkCommandAvailability(command: string): {
  available: boolean;
  resolvedPath: string | null;
  installHint: string | null;
} {
  const resolvedPath = resolveCommand(command);
  return {
    available: resolvedPath !== null,
    resolvedPath,
    installHint: resolvedPath ? null : getInstallHint(command),
  };
}

/**
 * Clear the command resolution cache (for testing).
 */
export function clearCommandCache(): void {
  cache.clear();
}
