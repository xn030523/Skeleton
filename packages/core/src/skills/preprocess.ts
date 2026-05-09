/**
 * Skill Preprocessing — template variable substitution and inline shell expansion.
 *
 * Replaces: ${SKELETON_SKILL_DIR}, ${SKELETON_SESSION_ID}, ${SKELETON_HOME}
 * Inline shell: !`command` → replaced with command output (capped 4K).
 *
 * Inspired by Hermes skill_preprocessing.py.
 */

import { execSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const MAX_SHELL_OUTPUT = 4096;
const SHELL_PATTERN = /!`([^`]+)`/g;

/** Preprocess skill content with template substitution and shell expansion */
export async function preprocessSkill(
  content: string,
  vars: Record<string, string> = {},
): Promise<string> {
  let result = content;

  // Template variable substitution
  const allVars: Record<string, string> = {
    SKELETON_SKILL_DIR: vars.SKELETON_SKILL_DIR ?? process.cwd(),
    SKELETON_SESSION_ID: vars.SKELETON_SESSION_ID ?? "unknown",
    SKELETON_HOME: vars.SKELETON_HOME ?? path.join(os.homedir(), ".skeleton"),
    SKELETON_CWD: vars.SKELETON_CWD ?? process.cwd(),
    SKELETON_DATE: new Date().toISOString().slice(0, 10),
    ...vars,
  };

  for (const [key, value] of Object.entries(allVars)) {
    const pattern = new RegExp(`\\$\\{${key}\\}`, "g");
    result = result.replace(pattern, value);
  }

  // Inline shell expansion
  result = result.replace(SHELL_PATTERN, (_match, command) => {
    try {
      const output = execSync(command, {
        encoding: "utf-8",
        timeout: 5000,
        maxBuffer: MAX_SHELL_OUTPUT,
      }).trim();
      return output.slice(0, MAX_SHELL_OUTPUT);
    } catch (err) {
      return `[shell error: ${(err as Error).message.slice(0, 100)}]`;
    }
  });

  return result;
}
