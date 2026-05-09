/**
 * Skill Usage Telemetry — per-skill usage tracking with lifecycle states.
 * Active → stale → archived lifecycle. Pinned skills are never auto-archived.
 *
 * Inspired by Hermes skill_usage.py.
 */

import fs from "node:fs";
import path from "node:path";

export type SkillLifecycle = "active" | "stale" | "archived" | "pinned";

export interface SkillUsageData {
  name: string;
  invocationCount: number;
  lastUsedAt: number;
  createdAt: number;
  lifecycle: SkillLifecycle;
  origin: "agent" | "user" | "hub";
}

const USAGE_FILE = ".skeleton/skills/_usage.json";

export function bumpSkillUsage(skillName: string, cwd?: string): SkillUsageData {
  const filePath = path.join(cwd ?? process.cwd(), USAGE_FILE);
  const allData = loadUsageData(filePath);

  const entry = allData[skillName] ?? {
    name: skillName,
    invocationCount: 0,
    lastUsedAt: 0,
    createdAt: Date.now(),
    lifecycle: "active" as SkillLifecycle,
    origin: "user" as const,
  };

  entry.invocationCount++;
  entry.lastUsedAt = Date.now();

  // Auto-promote stale → active on use
  if (entry.lifecycle === "stale") {
    entry.lifecycle = "active";
  }

  allData[skillName] = entry;
  saveUsageData(filePath, allData);
  return entry;
}

export function getSkillUsageData(skillName: string, cwd?: string): SkillUsageData | null {
  const filePath = path.join(cwd ?? process.cwd(), USAGE_FILE);
  const allData = loadUsageData(filePath);
  return allData[skillName] ?? null;
}

export function updateSkillLifecycle(skillName: string, state: SkillLifecycle, cwd?: string): void {
  const filePath = path.join(cwd ?? process.cwd(), USAGE_FILE);
  const allData = loadUsageData(filePath);
  if (allData[skillName]) {
    allData[skillName].lifecycle = state;
    saveUsageData(filePath, allData);
  }
}

export function listSkillUsage(cwd?: string): SkillUsageData[] {
  const filePath = path.join(cwd ?? process.cwd(), USAGE_FILE);
  const allData = loadUsageData(filePath);
  return Object.values(allData);
}

function loadUsageData(filePath: string): Record<string, SkillUsageData> {
  if (!fs.existsSync(filePath)) return {};
  try { return JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { return {}; }
}

function saveUsageData(filePath: string, data: Record<string, SkillUsageData>): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}
