import fs from "node:fs";
import path from "node:path";

export function loadEnv(envPath?: string): void {
  const resolved = envPath ?? path.join(process.cwd(), ".env");
  if (!fs.existsSync(resolved)) return;
  for (const line of fs.readFileSync(resolved, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = val;
  }
}
