import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * agentskills.io compatible SkillDef.
 * Spec: https://agentskills.io
 * - name: lowercase + hyphens, matches directory name
 * - description: ≤1024 chars
 * - content: Tier 2 instructions (SKILL.md body)
 * - resources: Tier 3 references (instructions/ + resources/ subdirs)
 */
export interface SkillDef {
  name: string;
  description: string;
  category: string;
  userInvocable: boolean;
  agentCreated?: boolean;
  /** OS platforms this skill supports (empty = all) */
  platforms?: string[];
  /** Absolute path to the skill directory on disk */
  skillDir?: string;
  content: () => string;
  /** Tier 3: list available resource files */
  listResources?: () => string[];
  /** Tier 3: load a specific resource file */
  loadResource?: (fileName: string) => string | null;
}

/** Cache entry for buildCatalog — two-layer LRU + disk snapshot */
interface CatalogCache {
  content: string;
  mtime: number;
  size: number;
}

export class SkillRegistry {
  private skills = new Map<string, SkillDef>();

  /** Discovery paths: project-level + user-level + external */
  private projectSkillDir: string;
  private userSkillDir: string;
  private externalDirs: string[] = [];
  private disabledSkills: Set<string> = new Set();
  private catalogCache: CatalogCache | null = null;

  constructor(projectSkillDir?: string, userSkillDir?: string) {
    this.projectSkillDir = projectSkillDir ?? path.join(process.cwd(), ".agents", "skills");
    this.userSkillDir = userSkillDir ?? path.join(os.homedir(), ".skeleton", "skills");
  }

  /** Set external skill directories */
  setExternalDirs(dirs: string[]): void {
    this.externalDirs = dirs.filter(d => fs.existsSync(d));
  }

  /** Set disabled skill names */
  setDisabledSkills(names: string[]): void {
    this.disabledSkills = new Set(names.map(n => n.trim().toLowerCase()));
  }

  /** Check if a skill name is disabled */
  isDisabled(name: string): boolean {
    return this.disabledSkills.has(name.toLowerCase());
  }

  register(skill: SkillDef): void {
    this.skills.set(skill.name, skill);
    this.invalidateCache();
  }

  unregister(name: string): boolean {
    const deleted = this.skills.delete(name);
    if (deleted) this.invalidateCache();
    return deleted;
  }

  update(name: string, patch: Partial<Pick<SkillDef, "description" | "content" | "category" | "userInvocable">>): boolean {
    const existing = this.skills.get(name);
    if (!existing) return false;
    if (patch.description !== undefined) existing.description = patch.description;
    if (patch.category !== undefined) existing.category = patch.category;
    if (patch.userInvocable !== undefined) existing.userInvocable = patch.userInvocable;
    if (patch.content !== undefined) {
      const newContent = patch.content;
      Object.defineProperty(existing, "content", {
        value: typeof newContent === "function" ? newContent : () => String(newContent),
        writable: true,
        configurable: true,
      });
    }
    this.invalidateCache();
    return true;
  }

  list(): SkillDef[] {
    return [...this.skills.values()];
  }

  listBySource(): { builtin: SkillDef[]; agent: SkillDef[] } {
    const builtin: SkillDef[] = [];
    const agent: SkillDef[] = [];
    for (const s of this.skills.values()) {
      (s.agentCreated ? agent : builtin).push(s);
    }
    return { builtin, agent };
  }

  get(name: string): SkillDef | undefined {
    return this.skills.get(name);
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  /** Get skill directory path for resource operations */
  getSkillDir(): string {
    return this.userSkillDir;
  }

  /** Load skills from project, user, and external directories.
   *  Built-in (non-agentCreated) skills are preserved; disk-loaded skills
   *  (agentCreated=true) are rebuilt from scratch so that on-disk deletions
   *  propagate into memory — matches Hermes reload_skills() semantics. */
  loadFromDisk(): number {
    // Drop stale disk-backed skills before rescanning so deletes propagate.
    for (const [name, skill] of Array.from(this.skills.entries())) {
      if (skill.agentCreated) this.skills.delete(name);
    }
    this.invalidateCache();

    let count = 0;

    // External directories (lowest priority)
    for (const dir of this.externalDirs) {
      count += this.loadFromDirectory(dir, "external");
    }

    // User-level skills
    count += this.loadFromDirectory(this.userSkillDir, "user");

    // Project-level skills (highest priority — override by name)
    count += this.loadFromDirectory(this.projectSkillDir, "project");

    return count;
  }

  /** Load skills from a specific directory following agentskills.io structure */
  private loadFromDirectory(dir: string, source: string): number {
    if (!fs.existsSync(dir)) return 0;
    let count = 0;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const skillPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        const skillMd = path.join(skillPath, "SKILL.md");
        if (fs.existsSync(skillMd)) {
          try {
            const raw = fs.readFileSync(skillMd, "utf-8");
            const parsed = parseSkillMd(raw);
            if (!parsed) continue;

            // Disabled check
            if (this.isDisabled(parsed.name)) continue;

            // Platform filter
            if (parsed.platforms && parsed.platforms.length > 0) {
              if (!matchesPlatform(parsed.platforms)) continue;
            }

            const instructionsDir = path.join(skillPath, "instructions");
            const resourcesDir = path.join(skillPath, "resources");
            const referencesDir = path.join(skillPath, "references");
            const templatesDir = path.join(skillPath, "templates");
            const scriptsDir = path.join(skillPath, "scripts");

            this.register({
              ...parsed,
              agentCreated: true,
              skillDir: skillPath,
              content: () => {
                const current = fs.readFileSync(skillMd, "utf-8");
                const p = parseSkillMd(current);
                let body = p?.body ?? current;

                // Append instructions/ files
                if (fs.existsSync(instructionsDir)) {
                  for (const f of fs.readdirSync(instructionsDir).filter((n) => n.endsWith(".md"))) {
                    body += `\n\n---\n## ${f}\n${fs.readFileSync(path.join(instructionsDir, f), "utf-8")}`;
                  }
                }

                // Inject supporting files listing
                const supportFiles = discoverSupportFiles(skillPath);
                if (supportFiles.length > 0) {
                  body += `\n\n[Skill directory: ${skillPath}]\n`;
                  body += "[Supporting files:]\n";
                  for (const sf of supportFiles) {
                    body += `- ${sf}  →  ${path.join(skillPath, sf)}\n`;
                  }
                  body += `\nRun scripts by absolute path. Load references with skill_view(name="${parsed.name}", file_path="<path>").`;
                }

                return body;
              },
              listResources: () => {
                const files: string[] = [];
                for (const subdir of [resourcesDir, referencesDir, templatesDir, scriptsDir]) {
                  if (fs.existsSync(subdir)) {
                    for (const f of fs.readdirSync(subdir)) {
                      const rel = path.relative(skillPath, path.join(subdir, f));
                      files.push(rel);
                    }
                  }
                }
                return files;
              },
              loadResource: (fileName: string) => {
                const fp = path.join(skillPath, fileName);
                if (!fs.existsSync(fp) || !fp.startsWith(skillPath)) return null;
                return fs.readFileSync(fp, "utf-8");
              },
            });
            count++;
          } catch {
            // skip malformed
          }
        }
      } else if (entry.name.endsWith(".md")) {
        // Legacy flat format: skill-name.md
        try {
          const raw = fs.readFileSync(skillPath, "utf-8");
          const parsed = parseSkillMd(raw);
          if (!parsed) continue;
          if (this.isDisabled(parsed.name)) continue;
          if (parsed.platforms && parsed.platforms.length > 0) {
            if (!matchesPlatform(parsed.platforms)) continue;
          }

          this.register({
            ...parsed,
            agentCreated: true,
            skillDir: path.dirname(skillPath),
            content: () => {
              const current = fs.readFileSync(skillPath, "utf-8");
              return parseSkillMd(current)?.body ?? current;
            },
          });
          count++;
        } catch {
          // skip
        }
      }
    }

    return count;
  }

  /** Persist skill to user-level directory in agentskills.io format */
  saveToDisk(skill: SkillDef): string {
    const skillName = skill.name.replace(/[^a-z0-9_-]/gi, "_");
    const skillDir = path.join(this.userSkillDir, skillName);
    fs.mkdirSync(skillDir, { recursive: true });

    const frontmatter = [
      `name: ${skill.name}`,
      `description: ${skill.description}`,
      `category: ${skill.category}`,
      `userInvocable: ${skill.userInvocable}`,
      `agentCreated: true`,
    ].join("\n");

    const body = typeof skill.content === "function" ? skill.content() : String(skill.content);
    const content = `---\n${frontmatter}\n---\n\n${body}\n`;

    fs.writeFileSync(path.join(skillDir, "SKILL.md"), content, "utf-8");
    return skillDir;
  }

  /** Delete skill directory from disk */
  deleteFromDisk(name: string): boolean {
    const skillName = name.replace(/[^a-z0-9_-]/gi, "_");
    const skillDir = path.join(this.userSkillDir, skillName);
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true, force: true });
      return true;
    }
    // Legacy flat format fallback
    const flatFile = path.join(this.userSkillDir, `${skillName}.md`);
    if (fs.existsSync(flatFile)) {
      fs.unlinkSync(flatFile);
      return true;
    }
    return false;
  }

  /** Build manifest of on-disk SKILL.md files (path → [mtime, size]) for cache validation */
  private buildCatalogManifest(): Record<string, [number, number]> {
    const manifest: Record<string, [number, number]> = {};
    const dirs = [this.userSkillDir, this.projectSkillDir, ...this.externalDirs];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith(".")) continue;
          const skillPath = path.join(dir, entry.name);
          const skillMd = entry.isDirectory()
            ? path.join(skillPath, "SKILL.md")
            : (entry.name.endsWith(".md") ? skillPath : null);
          if (!skillMd || !fs.existsSync(skillMd)) continue;
          try {
            const st = fs.statSync(skillMd);
            manifest[skillMd] = [st.mtimeMs, st.size];
          } catch { /* ignore */ }
        }
      } catch { /* ignore dir errors */ }
    }
    // Fingerprint built-in (non-agentCreated) skills by name+description hash so
    // they invalidate the snapshot on code change without touching disk.
    for (const skill of this.skills.values()) {
      if (!skill.agentCreated) {
        const key = `builtin:${skill.name}`;
        manifest[key] = [0, (skill.description ?? "").length];
      }
    }
    return manifest;
  }

  /** Tier 1: compact catalog — agentskills.io spec, with two-layer cache (memory + disk snapshot) */
  buildCatalog(): string {
    const cachePath = path.join(this.userSkillDir, ".catalog_cache.json");
    const currentManifest = this.buildCatalogManifest();
    const manifestKey = JSON.stringify(currentManifest);

    // Layer 1: in-memory cache
    if (this.catalogCache && this.catalogCache.mtime === hashString(manifestKey)) {
      return this.catalogCache.content;
    }

    // Layer 2: on-disk snapshot (survives process restarts)
    if (fs.existsSync(cachePath)) {
      try {
        const raw = fs.readFileSync(cachePath, "utf-8");
        const snapshot = JSON.parse(raw) as { manifest: string; content: string };
        if (snapshot.manifest === manifestKey) {
          this.catalogCache = {
            content: snapshot.content,
            mtime: hashString(manifestKey),
            size: this.skills.size,
          };
          return snapshot.content;
        }
      } catch { /* fall through to rebuild */ }
    }

    // Cold path: rebuild catalog from in-memory registry
    const categories = new Map<string, SkillDef[]>();
    for (const skill of this.skills.values()) {
      const list = categories.get(skill.category) ?? [];
      list.push(skill);
      categories.set(skill.category, list);
    }

    const lines: string[] = [];
    for (const [cat, skills] of categories) {
      lines.push(`${cat}:`);
      for (const s of skills) {
        const invocable = s.userInvocable ? " [invocable]" : "";
        const created = s.agentCreated ? " (custom)" : "";
        lines.push(`  - ${s.name}: ${s.description}${invocable}${created}`);
      }
    }
    const content = lines.join("\n");

    // Write both cache layers
    this.catalogCache = {
      content,
      mtime: hashString(manifestKey),
      size: this.skills.size,
    };
    try {
      fs.mkdirSync(this.userSkillDir, { recursive: true });
      fs.writeFileSync(cachePath, JSON.stringify({ manifest: manifestKey, content }), "utf-8");
    } catch { /* non-critical */ }

    return content;
  }

  /** Tier 2: full instructions for specific skills */
  loadSkills(names: string[]): string {
    const parts: string[] = [];
    for (const name of names) {
      const skill = this.skills.get(name);
      if (skill) {
        parts.push(`\n# Skill: ${skill.name}\n\n${skill.content()}`);
      }
    }
    return parts.join("\n");
  }

  /** Tier 3: list resources for a skill */
  listSkillResources(name: string): string[] {
    const skill = this.skills.get(name);
    if (!skill?.listResources) return [];
    return skill.listResources();
  }

  /** Tier 3: load a resource file for a skill */
  loadSkillResource(name: string, fileName: string): string | null {
    const skill = this.skills.get(name);
    if (!skill?.loadResource) return null;
    return skill.loadResource(fileName);
  }

  /** Load all skill instructions */
  loadAll(): string {
    return this.loadSkills([...this.skills.keys()]);
  }

  private invalidateCache(): void {
    this.catalogCache = null;
  }
}

export interface SkillConfig {
  /**
   * CTF skill loading mode:
   * - true (default): register CTF skills; catalog mode (names + descriptions only)
   * - false: do not register CTF skills
   * - "auto": alias for true (kept for backward compat)
   * - "all": eagerly inject full skill content into system prompt (legacy, token-heavy)
   */
  ctf?: boolean | "auto" | "all";
}

/** Parse a SKILL.md file with YAML frontmatter */
function parseSkillMd(raw: string): Omit<SkillDef, "agentCreated" | "content" | "listResources" | "loadResource" | "skillDir"> & { body: string } | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = match[1];
  const body = match[2].trim();

  let name = "";
  let description = "";
  let category = "general";
  let userInvocable = false;
  let platforms: string[] = [];

  for (const line of frontmatter.split("\n")) {
    const [key, ...rest] = line.split(":");
    const val = rest.join(":").trim();
    if (key === "name") name = val;
    else if (key === "description") description = val;
    else if (key === "category") category = val;
    else if (key === "userInvocable") userInvocable = val === "true";
    else if (key === "platforms") {
      // Parse [macos, linux] or "macos, linux"
      const cleaned = val.replace(/[\[\]]/g, "");
      platforms = cleaned.split(",").map(s => s.trim()).filter(Boolean);
    }
  }

  if (!name) return null;
  return { name, description, category, userInvocable, platforms: platforms.length > 0 ? platforms : undefined, body };
}

/** Check if current OS matches the skill's platform requirements */
function matchesPlatform(platforms: string[]): boolean {
  const current = process.platform;
  const map: Record<string, string> = {
    macos: "darwin", linux: "linux", windows: "win32",
  };
  return platforms.some(p => {
    const mapped = map[p.toLowerCase()] ?? p.toLowerCase();
    return current.startsWith(mapped);
  });
}

/** Discover supporting files (references/templates/scripts/assets) in a skill dir */
function discoverSupportFiles(skillDir: string): string[] {
  const files: string[] = [];
  for (const subdir of ["references", "templates", "scripts", "assets"]) {
    const full = path.join(skillDir, subdir);
    if (!fs.existsSync(full)) continue;
    for (const f of fs.readdirSync(full)) {
      const fp = path.join(full, f);
      if (fs.statSync(fp).isFile()) {
        files.push(`${subdir}/${f}`);
      }
    }
  }
  return files;
}

/** Fast non-crypto hash (djb2) for manifest fingerprinting */
function hashString(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  }
  return h;
}
