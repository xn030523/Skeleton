import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_CDP_PORT = 9222;

export interface ChromeLaunchResult {
  cdpUrl: string;
  port: number;
  pid?: number;
}

export function findChromePath(): string | null {
  const envPath = process.env.CHROME_PATH;
  if (envPath && existsSync(envPath)) return envPath;

  const platform = process.platform;
  if (platform === "win32") {
    const suffixes = [
      "\\Google\\Chrome\\Application\\chrome.exe",
      "\\Google\\Chrome Beta\\Application\\chrome.exe",
      "\\Google\\Chrome Dev\\Application\\chrome.exe",
      "\\Chromium\\Application\\chrome.exe",
      "\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
      "\\Microsoft\\Edge\\Application\\msedge.exe",
    ];
    const prefixes = [
      process.env["PROGRAMFILES"] ?? "C:\\Program Files",
      process.env["PROGRAMFILES(X86)"] ?? "C:\\Program Files (x86)",
      process.env["LOCALAPPDATA"] ?? "",
    ];
    for (const prefix of prefixes) {
      if (!prefix) continue;
      for (const suffix of suffixes) {
        const candidate = prefix + suffix;
        if (existsSync(candidate)) return candidate;
      }
    }
  } else if (platform === "darwin") {
    const candidates = [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  } else {
    // Linux
    const binaries = ["google-chrome-stable", "google-chrome", "chromium-browser", "chromium", "brave-browser", "microsoft-edge"];
    for (const b of binaries) {
      try {
        const result = execFileSync("which", [b], { encoding: "utf8", timeout: 2000 }).trim();
        if (result && existsSync(result)) return result;
      } catch { /* not found */ }
    }
  }
  return null;
}

export async function discoverCdpUrl(port: number = DEFAULT_CDP_PORT): Promise<string | null> {
  try {
    const resp = await fetch(`http://127.0.0.1:${port}/json/version`);
    if (!resp.ok) return null;
    const info = await resp.json() as { webSocketDebuggerUrl?: string };
    return info.webSocketDebuggerUrl ?? null;
  } catch {
    return null;
  }
}

export async function launchChrome(opts?: { port?: number; headless?: boolean }): Promise<ChromeLaunchResult> {
  const chromePath = findChromePath();
  if (!chromePath) {
    throw new Error("Chrome/Chromium not found. Set CHROME_PATH env var or install Chrome.");
  }

  const port = opts?.port ?? DEFAULT_CDP_PORT;
  const headless = opts?.headless ?? false;
  const dataDir = join(homedir(), ".skeleton", "chrome-debug");

  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${dataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
  ];
  if (headless) args.push("--headless=new");

  const { spawn } = await import("node:child_process");
  const proc = spawn(chromePath, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  proc.unref();

  // Wait for CDP to become available
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 500));
    const wsUrl = await discoverCdpUrl(port);
    if (wsUrl) {
      return { cdpUrl: wsUrl, port, pid: proc.pid };
    }
  }

  throw new Error(`Chrome launched but CDP not available on port ${port} after 15s`);
}

export function manualChromeCommand(port: number = DEFAULT_CDP_PORT): string | null {
  const chromePath = findChromePath();
  if (!chromePath) return null;
  const dataDir = join(homedir(), ".skeleton", "chrome-debug");
  return `${chromePath} --remote-debugging-port=${port} --user-data-dir="${dataDir}" --no-first-run --no-default-browser-check`;
}
