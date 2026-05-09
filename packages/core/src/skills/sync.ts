/**
 * Skill Sync — synchronize skills from a remote manifest URL with
 * conflict resolution and status tracking.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface SyncManifest {
  version: number;
  skills: SyncManifestEntry[];
}

export interface SyncManifestEntry {
  name: string;
  url: string;
  checksum: string;
}

export interface SyncStatus {
  lastSync: string | null;
  syncedSkills: string[];
  failedSkills: string[];
  totalRemote: number;
  totalLocal: number;
}

export type ConflictResolution = "keep_local" | "keep_remote" | "merge";

export class SkillSync {
  private skillDir: string;
  private statusPath: string;
  private status: SyncStatus;

  constructor(opts?: { skillDir?: string }) {
    this.skillDir = opts?.skillDir ?? path.join(os.homedir(), ".skeleton", "skills");
    this.statusPath = path.join(this.skillDir, ".sync-status.json");
    this.status = {
      lastSync: null,
      syncedSkills: [],
      failedSkills: [],
      totalRemote: 0,
      totalLocal: 0,
    };
    this.loadStatus();
  }

  /** Sync skills from a remote manifest URL */
  async syncFromManifest(url: string): Promise<SyncStatus> {
    this.status.syncedSkills = [];
    this.status.failedSkills = [];

    let manifest: SyncManifest;
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      manifest = (await resp.json()) as SyncManifest;
    } catch (err) {
      throw new Error(`Failed to fetch manifest: ${(err as Error).message}`);
    }

    if (!manifest.version || !Array.isArray(manifest.skills)) {
      throw new Error("Invalid manifest format");
    }

    this.status.totalRemote = manifest.skills.length;

    if (!fs.existsSync(this.skillDir)) {
      fs.mkdirSync(this.skillDir, { recursive: true });
    }

    for (const entry of manifest.skills) {
      try {
        const localPath = path.join(this.skillDir, `${entry.name}.md`);
        const localContent = fs.existsSync(localPath) ? fs.readFileSync(localPath, "utf-8") : null;

        const resp = await fetch(entry.url, { signal: AbortSignal.timeout(10000) });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const remoteContent = await resp.text();

        if (localContent) {
          const resolved = this.resolveConflicts(localContent, remoteContent);
          fs.writeFileSync(localPath, resolved, "utf-8");
        } else {
          fs.writeFileSync(localPath, remoteContent, "utf-8");
        }

        this.status.syncedSkills.push(entry.name);
      } catch (err) {
        this.status.failedSkills.push(entry.name);
      }
    }

    this.status.lastSync = new Date().toISOString();
    this.status.totalLocal = fs.readdirSync(this.skillDir).filter((f) => f.endsWith(".md")).length;
    this.saveStatus();
    return { ...this.status };
  }

  /** Resolve conflicts between local and remote skill content */
  resolveConflicts(local: string, remote: string, strategy: ConflictResolution = "keep_remote"): string {
    switch (strategy) {
      case "keep_local":
        return local;
      case "keep_remote":
        return remote;
      case "merge":
        return `${local}\n\n--- MERGED REMOTE ---\n\n${remote}`;
    }
  }

  /** Get current sync status */
  getSyncStatus(): SyncStatus {
    return { ...this.status };
  }

  private loadStatus(): void {
    if (fs.existsSync(this.statusPath)) {
      try {
        const raw = fs.readFileSync(this.statusPath, "utf-8");
        this.status = JSON.parse(raw);
      } catch {
        // keep default
      }
    }
  }

  private saveStatus(): void {
    if (!fs.existsSync(this.skillDir)) {
      fs.mkdirSync(this.skillDir, { recursive: true });
    }
    fs.writeFileSync(this.statusPath, JSON.stringify(this.status, null, 2), "utf-8");
  }
}
