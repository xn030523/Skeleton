/**
 * Skill Curator — automatic skill maintenance: dedup, categorize, detect stale.
 *
 * Runs as a background pass over the skill registry:
 * - Detect duplicate/near-duplicate skills
 * - Auto-categorize uncategorized skills
 * - Flag skills that haven't been used in N days
 * - Clean up orphaned skill files
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { SkillDef, SkillRegistry } from "./registry.js";

export interface CuratorReport {
  totalSkills: number;
  duplicates: Array<{ name1: string; name2: string; similarity: number }>;
  uncategorized: string[];
  stale: Array<{ name: string; lastUsed: string | null }>;
  orphanedFiles: string[];
  autoFixed: number;
}

const SKILLS_DIR = path.join(os.homedir(), ".skeleton", "skills");

export class SkillCurator {
  private skillRegistry: SkillRegistry;
  private usageDataPath: string;

  constructor(skillRegistry: SkillRegistry) {
    this.skillRegistry = skillRegistry;
    this.usageDataPath = path.join(os.homedir(), ".skeleton", "skill-usage.json");
  }

  /** Run full curator pass and return a report */
  run(opts: { staleDays?: number } = {}): CuratorReport {
    const staleDays = opts.staleDays ?? 30;
    const skills = this.skillRegistry.list();
    const report: CuratorReport = {
      totalSkills: skills.length,
      duplicates: [],
      uncategorized: [],
      stale: [],
      orphanedFiles: [],
      autoFixed: 0,
    };

    // 1. Detect duplicates (name similarity + content overlap)
    for (let i = 0; i < skills.length; i++) {
      for (let j = i + 1; j < skills.length; j++) {
        const sim = nameSimilarity(skills[i].name, skills[j].name);
        if (sim > 0.7) {
          report.duplicates.push({
            name1: skills[i].name,
            name2: skills[j].name,
            similarity: Math.round(sim * 100) / 100,
          });
        }
      }
    }

    // 2. Find uncategorized skills (category = "general" or empty)
    for (const s of skills) {
      if (!s.category || s.category === "general" || s.category === "default") {
        report.uncategorized.push(s.name);
        // Auto-categorize based on description keywords
        const newCategory = autoCategorize(s);
        if (newCategory !== s.category) {
          this.skillRegistry.update(s.name, { category: newCategory });
          report.autoFixed++;
        }
      }
    }

    // 3. Detect stale skills (not used in N days)
    const usage = this.loadUsageData();
    const cutoff = Date.now() - staleDays * 86400000;
    for (const s of skills) {
      const lastUsed = usage[s.name] ?? null;
      if (!lastUsed || lastUsed < cutoff) {
        report.stale.push({
          name: s.name,
          lastUsed: lastUsed ? new Date(lastUsed).toISOString().slice(0, 10) : null,
        });
      }
    }

    // 4. Detect orphaned files (files in skills dir not loaded by registry)
    const loadedNames = new Set(skills.map(s => s.name));
    if (fs.existsSync(SKILLS_DIR)) {
      for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
        const name = entry.name.replace(/\.md$/, "");
        if (!loadedNames.has(name) && (entry.isDirectory() || entry.name.endsWith(".md"))) {
          report.orphanedFiles.push(entry.name);
        }
      }
    }

    return report;
  }

  /** Record skill usage for staleness tracking */
  recordUsage(skillName: string): void {
    const usage = this.loadUsageData();
    usage[skillName] = Date.now();
    this.saveUsageData(usage);
  }

  /** Format curator report as terminal text */
  formatReport(report: CuratorReport): string {
    const lines: string[] = [
      `Skills: ${report.totalSkills} | Auto-fixed: ${report.autoFixed}`,
    ];

    if (report.duplicates.length > 0) {
      lines.push("", "Duplicates:");
      for (const d of report.duplicates) {
        lines.push(`  ${d.name1} ↔ ${d.name2} (${d.similarity * 100}%)`);
      }
    }

    if (report.uncategorized.length > 0) {
      lines.push("", `Uncategorized: ${report.uncategorized.join(", ")}`);
    }

    if (report.stale.length > 0) {
      lines.push("", `Stale (>30d unused):`);
      for (const s of report.stale) {
        lines.push(`  ${s.name} (last: ${s.lastUsed ?? "never"})`);
      }
    }

    if (report.orphanedFiles.length > 0) {
      lines.push("", `Orphaned files: ${report.orphanedFiles.join(", ")}`);
    }

    return lines.join("\n");
  }

  private loadUsageData(): Record<string, number> {
    try {
      if (fs.existsSync(this.usageDataPath)) {
        return JSON.parse(fs.readFileSync(this.usageDataPath, "utf-8"));
      }
    } catch { /* */ }
    return {};
  }

  private saveUsageData(data: Record<string, number>): void {
    try {
      fs.mkdirSync(path.dirname(this.usageDataPath), { recursive: true });
      fs.writeFileSync(this.usageDataPath, JSON.stringify(data, null, 2), "utf-8");
    } catch { /* non-critical */ }
  }
}

function nameSimilarity(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la === lb) return 1;
  // Simple Jaccard on bigrams
  const bigramsA = new Set<string>();
  const bigramsB = new Set<string>();
  for (let i = 0; i < la.length - 1; i++) bigramsA.add(la.slice(i, i + 2));
  for (let i = 0; i < lb.length - 1; i++) bigramsB.add(lb.slice(i, i + 2));
  let intersection = 0;
  for (const b of bigramsA) { if (bigramsB.has(b)) intersection++; }
  const union = bigramsA.size + bigramsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function autoCategorize(skill: SkillDef): string {
  const desc = (skill.description ?? "").toLowerCase();
  const name = skill.name.toLowerCase();

  const categoryMap: Array<[string[], string]> = [
    [["web", "http", "url", "api", "rest", "graphql", "request", "fetch"], "web"],
    [["binary", "reverse", "disassembly", "decompile", "assembly", "elf", "pe", "ghidra", "ida"], "reverse"],
    [["crypto", "cipher", "encrypt", "decrypt", "hash", "rsa", "aes", "base64"], "crypto"],
    [["pwn", "exploit", "buffer", "overflow", "rop", "shellcode", "heap"], "pwn"],
    [["sql", "injection", "xss", "csrf", "ssti", "lfi", "rfi", "ssrf"], "web-security"],
    [["forensic", "memory", "disk", "pcap", "wireshark", "volatility"], "forensics"],
    [["misc", "stego", "encode", "decode", "obfuscation"], "misc"],
    [["network", "tcp", "udp", "scan", "nmap", "port"], "network"],
    [["code", "python", "javascript", "typescript", "develop", "debug", "lint"], "development"],
    [["docker", "container", "deploy", "kubernetes", "k8s"], "devops"],
    [["ai", "ml", "model", "llm", "neural", "transformer", "gpt"], "ai"],
    [["git", "version", "commit", "branch", "merge"], "git"],
  ];

  for (const [keywords, category] of categoryMap) {
    for (const kw of keywords) {
      if (desc.includes(kw) || name.includes(kw)) return category;
    }
  }

  return skill.category ?? "general";
}
