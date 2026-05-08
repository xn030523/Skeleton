import type { SkillDef, SkillRegistry } from "../registry.js";
import { solveChallengeSkill } from "./solve-challenge.js";
import { ctfReverseSkill } from "./ctf-reverse.js";
import { ctfPwnSkill } from "./ctf-pwn.js";
import { ctfCryptoSkill } from "./ctf-crypto.js";
import { ctfWebSkill } from "./ctf-web.js";
import { ctfForensicsSkill } from "./ctf-forensics.js";
import { ctfMiscSkill } from "./ctf-misc.js";
import { ctfOsintSkill } from "./ctf-osint.js";
import { ctfMalwareSkill } from "./ctf-malware.js";
import { ctfAiMlSkill } from "./ctf-ai-ml.js";
import { ctfWriteupSkill } from "./ctf-writeup.js";
import { jsDeobfuscationSkill } from "./ctf-js-deobfuscation.js";
import { wasmReverseSkill } from "./ctf-wasm-reverse.js";
import { bundleAnalysisSkill } from "./ctf-bundle-analysis.js";
import { chromeExtensionAuditSkill } from "./ctf-chrome-extension-audit.js";
import { apiReverseSkill } from "./ctf-api-reverse.js";
import { antiBotBypassSkill } from "./ctf-anti-bot-bypass.js";

const CTF_SKILLS: SkillDef[] = [
  solveChallengeSkill,
  ctfReverseSkill,
  ctfPwnSkill,
  ctfCryptoSkill,
  ctfWebSkill,
  ctfForensicsSkill,
  ctfMiscSkill,
  ctfOsintSkill,
  ctfMalwareSkill,
  ctfAiMlSkill,
  ctfWriteupSkill,
  // Web Reverse Engineering (granular skills per agentskills.io)
  jsDeobfuscationSkill,
  wasmReverseSkill,
  bundleAnalysisSkill,
  chromeExtensionAuditSkill,
  apiReverseSkill,
  antiBotBypassSkill,
];

export function registerCtfSkills(registry: SkillRegistry): void {
  for (const skill of CTF_SKILLS) {
    registry.register(skill);
  }
}

export {
  solveChallengeSkill, ctfReverseSkill, ctfPwnSkill, ctfCryptoSkill,
  ctfWebSkill, ctfForensicsSkill, ctfMiscSkill, ctfOsintSkill,
  ctfMalwareSkill, ctfAiMlSkill, ctfWriteupSkill,
  jsDeobfuscationSkill, wasmReverseSkill, bundleAnalysisSkill,
  chromeExtensionAuditSkill, apiReverseSkill, antiBotBypassSkill,
};
