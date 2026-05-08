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

  /** Discovery paths: project-level + user-level */
  private projectSkillDir: string;
  private userSkillDir: string;
  private catalogCache: CatalogCache | null = null;

  constructor(projectSkillDir?: string, userSkillDir?: string) {
    this.projectSkillDir = projectSkillDir ?? path.join(process.cwd(), ".agents", "skills");
    this.userSkillDir = userSkillDir ?? path.join(os.homedir(), ".skeleton", "skills");
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

  /** Load skills from both project-level and user-level directories */
  loadFromDisk(): number {
    let count = 0;

    // User-level skills (lower priority)
    count += this.loadFromDirectory(this.userSkillDir, "user");

    // Project-level skills (higher priority — override user-level by name)
    count += this.loadFromDirectory(this.projectSkillDir, "project");

    return count;
  }

  /** Load skills from a specific directory following agentskills.io structure */
  private loadFromDirectory(dir: string, source: string): number {
    if (!fs.existsSync(dir)) return 0;
    let count = 0;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const skillPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // agentskills.io: skill-name/SKILL.md
        const skillMd = path.join(skillPath, "SKILL.md");
        if (fs.existsSync(skillMd)) {
          try {
            const raw = fs.readFileSync(skillMd, "utf-8");
            const parsed = parseSkillMd(raw);
            if (parsed) {
              const instructionsDir = path.join(skillPath, "instructions");
              const resourcesDir = path.join(skillPath, "resources");

              this.register({
                ...parsed,
                agentCreated: true,
                content: () => {
                  const current = fs.readFileSync(skillMd, "utf-8");
                  const p = parseSkillMd(current);
                  let body = p?.body ?? current;
                  // Append instructions/ files if they exist
                  if (fs.existsSync(instructionsDir)) {
                    for (const f of fs.readdirSync(instructionsDir).filter((n) => n.endsWith(".md"))) {
                      body += `\n\n---\n## ${f}\n${fs.readFileSync(path.join(instructionsDir, f), "utf-8")}`;
                    }
                  }
                  return body;
                },
                listResources: () => {
                  if (!fs.existsSync(resourcesDir)) return [];
                  return fs.readdirSync(resourcesDir);
                },
                loadResource: (fileName: string) => {
                  const fp = path.join(resourcesDir, fileName);
                  if (!fs.existsSync(fp)) return null;
                  return fs.readFileSync(fp, "utf-8");
                },
              });
              count++;
            }
          } catch {
            // skip malformed
          }
        }
      } else if (entry.name.endsWith(".md")) {
        // Legacy flat format: skill-name.md
        try {
          const raw = fs.readFileSync(skillPath, "utf-8");
          const parsed = parseSkillMd(raw);
          if (parsed) {
            this.register({
              ...parsed,
              agentCreated: true,
              content: () => {
                const current = fs.readFileSync(skillPath, "utf-8");
                return parseSkillMd(current)?.body ?? current;
              },
            });
            count++;
          }
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

  /** Tier 1: compact catalog — agentskills.io spec, with two-layer cache */
  buildCatalog(): string {
    // Check disk cache
    const cachePath = path.join(this.userSkillDir, ".catalog_cache.json");
    if (this.catalogCache && fs.existsSync(cachePath)) {
      try {
        const cached = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as CatalogCache;
        if (cached.mtime === this.catalogCache.mtime && cached.size === this.catalogCache.size) {
          return cached.content;
        }
      } catch { /* rebuild */ }
    }

    const categories = new Map<string, SkillDef[]>();
    for (const skill of this.skills.values()) {
      const list = categories.get(skill.category) ?? [];
      list.push(skill);
      categories.set(skill.category, list);
    }

    const lines: string[] = ["<available_skills>"];
    for (const [cat, skills] of categories) {
      lines.push(`${cat}:`);
      for (const s of skills) {
        const invocable = s.userInvocable ? " [invocable]" : "";
        const created = s.agentCreated ? " (custom)" : "";
        lines.push(`  - ${s.name}: ${s.description}${invocable}${created}`);
      }
    }
    lines.push("</available_skills>");
    const content = lines.join("\n");

    // Write cache
    try {
      fs.mkdirSync(this.userSkillDir, { recursive: true });
      const cache: CatalogCache = {
        content,
        mtime: Date.now(),
        size: this.skills.size,
      };
      fs.writeFileSync(cachePath, JSON.stringify(cache), "utf-8");
      this.catalogCache = cache;
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
  ctf?: boolean | "auto";
}

/** Parse a SKILL.md file with YAML frontmatter */
function parseSkillMd(raw: string): Omit<SkillDef, "agentCreated" | "content" | "listResources" | "loadResource"> & { body: string } | null {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n\n([\s\S]*)$/);
  if (!match) return null;

  const frontmatter = match[1];
  const body = match[2].trim();

  let name = "";
  let description = "";
  let category = "general";
  let userInvocable = false;

  for (const line of frontmatter.split("\n")) {
    const [key, ...rest] = line.split(":");
    const val = rest.join(":").trim();
    if (key === "name") name = val;
    else if (key === "description") description = val;
    else if (key === "category") category = val;
    else if (key === "userInvocable") userInvocable = val === "true";
  }

  if (!name) return null;
  return { name, description, category, userInvocable, body };
}
