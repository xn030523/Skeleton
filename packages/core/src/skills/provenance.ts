/**
 * Skill Provenance — track who created skills (agent vs user vs hub).
 * The curator only touches agent-created skills.
 *
 * Inspired by Hermes skill_provenance.py.
 */

import fs from "node:fs";
import path from "node:path";

type WriteOrigin = "agent" | "user" | "hub";
let currentOrigin: WriteOrigin = "user";

/** Set the current write origin for skill operations */
export function setWriteOrigin(origin: WriteOrigin): void {
  currentOrigin = origin;
}

/** Get the current write origin */
export function getWriteOrigin(): WriteOrigin {
  return currentOrigin;
}

/** Check if a skill was created by the agent */
export function isAgentCreated(skillName: string, skillsDir?: string): boolean {
  const provenancePath = resolveProvenancePath(skillsDir);
  if (!fs.existsSync(provenancePath)) return false;

  try {
    const data = JSON.parse(fs.readFileSync(provenancePath, "utf-8")) as Record<string, WriteOrigin>;
    return data[skillName] === "agent";
  } catch { return false; }
}

/** Record the origin of a skill */
export function recordSkillOrigin(skillName: string, origin?: WriteOrigin, skillsDir?: string): void {
  const provenancePath = resolveProvenancePath(skillsDir);
  let data: Record<string, WriteOrigin> = {};

  if (fs.existsSync(provenancePath)) {
    try { data = JSON.parse(fs.readFileSync(provenancePath, "utf-8")); } catch { /* */ }
  }

  data[skillName] = origin ?? currentOrigin;
  fs.mkdirSync(path.dirname(provenancePath), { recursive: true });
  fs.writeFileSync(provenancePath, JSON.stringify(data, null, 2));
}

/** Get provenance for all skills */
export function getAllProvenance(skillsDir?: string): Record<string, WriteOrigin> {
  const provenancePath = resolveProvenancePath(skillsDir);
  if (!fs.existsSync(provenancePath)) return {};
  try { return JSON.parse(fs.readFileSync(provenancePath, "utf-8")); } catch { return {}; }
}

function resolveProvenancePath(skillsDir?: string): string {
  const dir = skillsDir ?? path.join(process.cwd(), ".skeleton", "skills");
  return path.join(dir, "_provenance.json");
}
