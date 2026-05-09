/**
 * Update System — check for and apply Skeleton CLI updates.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SKELETON_DIR = path.join(os.homedir(), ".skeleton");
const UPDATE_CHECK_PATH = path.join(SKELETON_DIR, "update-check.json");

export interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  lastChecked: string;
}

export function getCurrentVersion(): string {
  try {
    const pkgPath = path.join(process.cwd(), "package.json");
    if (fs.existsSync(pkgPath)) {
      return JSON.parse(fs.readFileSync(pkgPath, "utf-8")).version ?? "0.0.0";
    }
  } catch { /* */ }
  return "0.1.0";
}

export async function checkForUpdate(): Promise<UpdateInfo> {
  const currentVersion = getCurrentVersion();
  let latestVersion = currentVersion;

  try {
    const result = execSync("npm view @skeleton/cli version 2>/dev/null || echo unknown", {
      encoding: "utf-8",
      timeout: 15000,
    }).trim();
    if (result && result !== "unknown") {
      latestVersion = result;
    }
  } catch { /* offline */ }

  const info: UpdateInfo = {
    currentVersion,
    latestVersion,
    hasUpdate: latestVersion !== currentVersion && latestVersion !== "0.0.0",
    lastChecked: new Date().toISOString(),
  };

  // Cache check result
  try {
    fs.mkdirSync(SKELETON_DIR, { recursive: true });
    fs.writeFileSync(UPDATE_CHECK_PATH, JSON.stringify(info, null, 2), "utf-8");
  } catch { /* non-critical */ }

  return info;
}

export async function applyUpdate(): Promise<{ success: boolean; message: string }> {
  try {
    execSync("npm update -g @skeleton/cli 2>&1", { encoding: "utf-8", timeout: 60000 });
    return { success: true, message: "Update applied successfully. Restart Skeleton to use the new version." };
  } catch (err) {
    return { success: false, message: `Update failed: ${(err as Error).message}` };
  }
}

export function getLastUpdateCheck(): UpdateInfo | null {
  try {
    if (fs.existsSync(UPDATE_CHECK_PATH)) {
      return JSON.parse(fs.readFileSync(UPDATE_CHECK_PATH, "utf-8"));
    }
  } catch { /* */ }
  return null;
}
