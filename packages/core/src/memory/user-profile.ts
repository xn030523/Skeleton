import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface UserProfileData {
  preferences: string[];
  projects: string[];
  environment: string[];
  notes: string[];
}

const DEFAULT_PROFILE: UserProfileData = {
  preferences: [],
  projects: [],
  environment: [],
  notes: [],
};

/**
 * Global user profile stored at ~/.skeleton/user.md
 * Frozen at session start for prefix cache consistency.
 */
export class UserProfile {
  private filePath: string;
  private frozenSnapshot: string | null = null;

  constructor(profilePath?: string) {
    this.filePath = profilePath ?? path.join(os.homedir(), ".skeleton", "user.md");
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    if (!fs.existsSync(this.filePath)) {
      this.writeDisk(DEFAULT_PROFILE);
    }
  }

  /** Freeze snapshot at session start — subsequent writes go to disk but don't mutate snapshot */
  freezeSnapshot(): string {
    const data = this.readDisk();
    this.frozenSnapshot = this.formatForPrompt(data);
    return this.frozenSnapshot;
  }

  /** Get frozen snapshot (session-start state). Falls back to live read if not frozen. */
  getSnapshot(): string {
    if (this.frozenSnapshot) return this.frozenSnapshot;
    const data = this.readDisk();
    return this.formatForPrompt(data);
  }

  /** Read live data from disk (bypasses snapshot — use for explicit user reads) */
  getLive(): UserProfileData {
    return this.readDisk();
  }

  addPreference(pref: string): void {
    const data = this.readDisk();
    if (!data.preferences.some((p) => p.toLowerCase() === pref.toLowerCase())) {
      data.preferences.push(pref);
      this.writeDisk(data);
    }
  }

  removePreference(pref: string): boolean {
    const data = this.readDisk();
    const idx = data.preferences.findIndex((p) => p.toLowerCase() === pref.toLowerCase());
    if (idx === -1) return false;
    data.preferences.splice(idx, 1);
    this.writeDisk(data);
    return true;
  }

  addProject(desc: string): void {
    const data = this.readDisk();
    if (!data.projects.some((p) => p.toLowerCase() === desc.toLowerCase())) {
      data.projects.push(desc);
      this.writeDisk(data);
    }
  }

  addEnvironment(env: string): void {
    const data = this.readDisk();
    if (!data.environment.some((e) => e.toLowerCase() === env.toLowerCase())) {
      data.environment.push(env);
      this.writeDisk(data);
    }
  }

  addNote(note: string): void {
    const data = this.readDisk();
    data.notes.push(note);
    this.writeDisk(data);
  }

  private readDisk(): UserProfileData {
    if (!fs.existsSync(this.filePath)) return { ...DEFAULT_PROFILE };
    const raw = fs.readFileSync(this.filePath, "utf-8");
    return this.parse(raw);
  }

  private writeDisk(data: UserProfileData): void {
    const lines: string[] = ["# Skeleton User Profile", ""];
    lines.push("## Preferences", ...data.preferences.map((p) => `- ${p}`), "");
    lines.push("## Projects", ...data.projects.map((p) => `- ${p}`), "");
    lines.push("## Environment", ...data.environment.map((e) => `- ${e}`), "");
    lines.push("## Notes", ...data.notes.map((n) => `- ${n}`), "");
    fs.writeFileSync(this.filePath, lines.join("\n"), "utf-8");
  }

  private parse(raw: string): UserProfileData {
    const data: UserProfileData = { ...DEFAULT_PROFILE };
    let section: keyof UserProfileData | null = null;

    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("## Preferences")) { section = "preferences"; continue; }
      if (trimmed.startsWith("## Projects")) { section = "projects"; continue; }
      if (trimmed.startsWith("## Environment")) { section = "environment"; continue; }
      if (trimmed.startsWith("## Notes")) { section = "notes"; continue; }
      if (trimmed.startsWith("#")) { section = null; continue; }

      if (section && trimmed.startsWith("- ")) {
        data[section].push(trimmed.slice(2));
      }
    }

    return data;
  }

  private formatForPrompt(data: UserProfileData): string {
    const parts: string[] = [];
    if (data.preferences.length > 0) {
      parts.push("### User Preferences", ...data.preferences.map((p) => `- ${p}`));
    }
    if (data.projects.length > 0) {
      parts.push("### Projects", ...data.projects.map((p) => `- ${p}`));
    }
    if (data.environment.length > 0) {
      parts.push("### Environment", ...data.environment.map((e) => `- ${e}`));
    }
    if (data.notes.length > 0) {
      parts.push("### Notes", ...data.notes.map((n) => `- ${n}`));
    }
    return parts.length > 0
      ? `## User Profile\n${parts.join("\n")}`
      : "";
  }
}
