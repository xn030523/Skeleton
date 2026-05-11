/**
 * Backup / import — bundle ~/.skeleton/ contents into a portable tar.
 *
 * Includes: config.yaml, memories DB, sessions DB, skills, personalities,
 * snapshots, plugins (not plugin-data), goal state.
 * Excludes: .env (secrets — user must re-enter), logs, plugin-data cache.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const HOME_SKELETON = path.join(os.homedir(), ".skeleton");

const INCLUDE_PATHS = [
  "config.yaml",
  "memories.db",
  "memories.db-shm",
  "memories.db-wal",
  "sessions.db",
  "sessions.db-shm",
  "sessions.db-wal",
  "skills",
  "personalities",
  "snapshots",
  "plugins",
  "goals",
  "honcho.json",
  "bg-tasks.json",
  "cron",
  "kanban",
  "user-profile.md",
];

const EXCLUDE_PATTERNS = [
  ".env",
  "logs",
  "plugin-data",
];

export interface BackupOptions {
  outputPath?: string;
  includeSecrets?: boolean;
}

export interface BackupResult {
  path: string;
  sizeBytes: number;
  entries: string[];
}

/** Create a .tar.gz backup of ~/.skeleton/ */
export async function createBackup(options?: BackupOptions): Promise<BackupResult> {
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outputPath = options?.outputPath ?? path.join(os.homedir(), `skeleton-backup-${ts}.tar.gz`);

  if (!fs.existsSync(HOME_SKELETON)) {
    throw new Error(`No ~/.skeleton/ directory found — nothing to back up`);
  }

  const includes: string[] = [];
  for (const entry of INCLUDE_PATHS) {
    const p = path.join(HOME_SKELETON, entry);
    if (fs.existsSync(p)) includes.push(entry);
  }
  if (options?.includeSecrets && fs.existsSync(path.join(HOME_SKELETON, ".env"))) {
    includes.push(".env");
  }

  if (includes.length === 0) {
    throw new Error(`~/.skeleton/ contains no backup-worthy files`);
  }

  const excludes: string[] = [];
  for (const ex of EXCLUDE_PATTERNS) {
    if (!options?.includeSecrets || ex !== ".env") {
      excludes.push(`--exclude=${ex}`);
    }
  }

  try {
    execFileSync("tar", [
      "-czf", outputPath,
      "-C", HOME_SKELETON,
      ...excludes,
      ...includes,
    ], { stdio: "pipe", timeout: 120_000 });
  } catch (err) {
    throw new Error(`Backup failed: ${(err as Error).message}. Is 'tar' available on this system?`);
  }

  const stat = fs.statSync(outputPath);
  return {
    path: outputPath,
    sizeBytes: stat.size,
    entries: includes,
  };
}

/** Restore a .tar.gz backup into ~/.skeleton/ */
export async function restoreBackup(backupPath: string, options?: { overwrite?: boolean }): Promise<{ restored: string[] }> {
  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`);
  }

  fs.mkdirSync(HOME_SKELETON, { recursive: true });

  // List backup contents first
  let listOutput = "";
  try {
    listOutput = execFileSync("tar", ["-tzf", backupPath], {
      encoding: "utf-8",
      timeout: 30_000,
    });
  } catch (err) {
    throw new Error(`Failed to read backup: ${(err as Error).message}`);
  }

  const entries = listOutput.split("\n").filter(Boolean);

  // Check for conflicts unless overwrite=true
  if (!options?.overwrite) {
    const conflicts: string[] = [];
    for (const entry of entries) {
      const target = path.join(HOME_SKELETON, entry);
      if (fs.existsSync(target)) conflicts.push(entry);
    }
    if (conflicts.length > 0) {
      throw new Error(`Conflicts detected (${conflicts.length} files exist). Use overwrite=true or remove them first:\n${conflicts.slice(0, 10).join("\n")}`);
    }
  }

  try {
    execFileSync("tar", [
      "-xzf", backupPath,
      "-C", HOME_SKELETON,
    ], { stdio: "pipe", timeout: 120_000 });
  } catch (err) {
    throw new Error(`Restore failed: ${(err as Error).message}`);
  }

  return { restored: entries };
}

/** Format backup size for display */
export function formatBackupSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
