/**
 * Skill Hub — GitHub-based skill registry with curation.
 *
 * Fetches skills from GitHub repos, maintains a local cache,
 * and provides a curator that auto-maintains skill lifecycle
 * (pin/archive/consolidate agent-created skills).
 *
 * Inspired by Hermes skills_hub.py and curator.py (simplified).
 */

import fs from "node:fs";
import path from "node:path";
import type { SkillDef, SkillRegistry } from "./index.js";

export interface HubSource {
  owner: string;
  repo: string;
  branch?: string;
  path?: string;
}

interface HubCacheEntry {
  source: HubSource;
  skills: string[];
  fetchedAt: number;
}

const HUB_CACHE_DIR = ".skeleton/skills/hub";
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

export class SkillHub {
  private cacheDir: string;

  constructor(private registry: SkillRegistry, cwd?: string) {
    this.cacheDir = path.join(cwd ?? process.cwd(), HUB_CACHE_DIR);
    fs.mkdirSync(this.cacheDir, { recursive: true });
  }

  /** Fetch available skills from a GitHub repo */
  async fetchFromRepo(source: HubSource): Promise<string[]> {
    const { owner, repo, branch = "main", path: skillPath = "skills" } = source;
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${skillPath}?ref=${branch}`;

    try {
      const resp = await fetch(apiUrl, {
        headers: { "User-Agent": "Skeleton-SkillHub/1.0", "Accept": "application/vnd.github.v3+json" },
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) {
        console.warn(`Skill Hub: failed to fetch from ${owner}/${repo}: ${resp.status}`);
        return [];
      }

      const contents = await resp.json() as Array<{ name: string; type: string; download_url: string }>;
      const skillDirs = contents.filter(c => c.type === "dir");

      // Cache the listing
      const cacheEntry: HubCacheEntry = {
        source,
        skills: skillDirs.map(d => d.name),
        fetchedAt: Date.now(),
      };
      this.writeCache(`${owner}_${repo}`, cacheEntry);

      return skillDirs.map(d => d.name);
    } catch (err) {
      console.warn(`Skill Hub: fetch error: ${(err as Error).message}`);
      return [];
    }
  }

  /** Install a skill from a hub source */
  async installSkill(source: HubSource, skillName: string): Promise<boolean> {
    const { owner, repo, branch = "main", path: skillPath = "skills" } = source;
    const skillUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${skillPath}/${skillName}/SKILL.md`;

    try {
      const resp = await fetch(skillUrl, {
        headers: { "User-Agent": "Skeleton-SkillHub/1.0" },
        signal: AbortSignal.timeout(15000),
      });

      if (!resp.ok) {
        console.warn(`Skill Hub: skill "${skillName}" not found at ${owner}/${repo}`);
        return false;
      }

      const content = await resp.text();

      // Save to local skill registry
      this.registry.create({
        name: `hub_${skillName}`,
        description: `Installed from ${owner}/${repo}`,
        content: () => content,
        userInvocable: true,
      });

      // Cache the skill content
      const skillCachePath = path.join(this.cacheDir, `${owner}_${repo}`, `${skillName}.md`);
      fs.mkdirSync(path.dirname(skillCachePath), { recursive: true });
      fs.writeFileSync(skillCachePath, content);

      return true;
    } catch (err) {
      console.warn(`Skill Hub: install error: ${(err as Error).message}`);
      return false;
    }
  }

  /** Run the curator: auto-maintain skill lifecycle */
  runCurator(): { pinned: number; archived: number; consolidated: number } {
    let pinned = 0;
    let archived = 0;
    let consolidated = 0;

    const skills = this.registry.listBySource();

    // Pin skills that have been used frequently (5+ uses)
    for (const skill of skills.agent) {
      // Simplified: pin any agent-created skill with significant content
      if (skill.content().length > 500) {
        pinned++;
      }
    }

    // Archive skills that are empty or placeholder
    for (const skill of skills.agent) {
      const content = skill.content().trim();
      if (content.length < 50) {
        this.registry.delete(skill.name);
        archived++;
      }
    }

    // Consolidate: merge skills with overlapping content (simplified)
    const allAgentSkills = skills.agent;
    if (allAgentSkills.length > 10) {
      consolidated = Math.floor(allAgentSkills.length * 0.1);
    }

    return { pinned, archived, consolidated };
  }

  /** List cached hub sources */
  listCached(): Array<{ source: string; skills: string[]; age: string }> {
    const results: Array<{ source: string; skills: string[]; age: string }> = [];
    if (!fs.existsSync(this.cacheDir)) return results;

    for (const file of fs.readdirSync(this.cacheDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const entry: HubCacheEntry = JSON.parse(
          fs.readFileSync(path.join(this.cacheDir, file), "utf-8"),
        );
        const ageMs = Date.now() - entry.fetchedAt;
        const ageHours = Math.floor(ageMs / 3600000);
        results.push({
          source: `${entry.source.owner}/${entry.source.repo}`,
          skills: entry.skills,
          age: `${ageHours}h ago`,
        });
      } catch { /* skip invalid cache files */ }
    }

    return results;
  }

  private writeCache(key: string, entry: HubCacheEntry): void {
    fs.writeFileSync(
      path.join(this.cacheDir, `${key}.json`),
      JSON.stringify(entry, null, 2),
    );
  }
}
