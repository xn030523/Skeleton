import type { SkillDef } from "../registry.js";

export const ctfWriteupSkill: SkillDef = {
  name: "ctf-writeup",
  description: "Generate standardized submission-style CTF writeup after solving a challenge. Concise, reproducible, one complete solve script.",
  category: "ctf",
  userInvocable: true,
  content: () => `# CTF Write-up Generator

Generate a standardized submission-style writeup for a solved challenge.

## Template

\`\`\`markdown
---
title: "<Challenge Name>"
ctf: "<Event>"
category: web|pwn|crypto|reverse|forensics|osint|malware|misc
difficulty: easy|medium|hard
points: <n>
---

# <Challenge Name>

## Summary
<1-2 sentences: what the challenge was and the core technique>

## Solution

### Step 1: <Key observation>
<Explain in 3-8 short lines>
\`\`\`python
<one complete solving script from challenge data to flag>
\`\`\`

### Step 2: <If needed> (optional)

## Flag
\`\`\`
flag{...}
\`\`\`
\`\`\`

## Guidelines
- Prefer 1-3 short steps total
- One complete solve script from challenge data to final flag
- Don't split "recover secret", "derive key", "decrypt flag" into separate snippets
- Show actual output to prove approach worked
- Tag code blocks with language
- Keep main path front-loaded for fast validation
- Don't include dead ends unless they explain a key pivot
- Don't assume reader knows the specific challenge setup`,
};
