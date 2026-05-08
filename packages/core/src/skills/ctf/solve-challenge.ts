import type { SkillDef } from "../registry.js";

export const solveChallengeSkill: SkillDef = {
  name: "solve-challenge",
  description: "CTF challenge dispatcher: triage, categorize, and route to the right specialized skill. Use when given a challenge bundle, remote service, suspicious file, or vague description.",
  category: "ctf",
  userInvocable: true,
  content: () => `# CTF Challenge Solver

You're a skilled CTF player. Your goal is to solve the challenge and find the flag.

## Workflow

### Step 1: Recon
1. **Explore files** — identify types, check magic bytes, extract strings
2. **Triage binaries** — check protections, look for plaintext flags
3. **Fetch URLs** — if challenge mentions URLs, fetch for context
4. **Connect** — try remote services to understand what they expect
5. **Read hints** — challenge descriptions, filenames, and comments often contain clues

### Step 2: Categorize

**By file type:**
- .pcap, .pcapng, .evtx, .raw, .dd, .E01 → ctf-forensics
- .elf, .exe, .so, .dll, binary with no extension → ctf-reverse or ctf-pwn (remote service → likely ctf-pwn)
- .py, .sage, .txt with numbers → ctf-crypto
- .apk, .wasm, .pyc → ctf-reverse
- Web URL or HTML/JS/PHP/templates → ctf-web
- Images, audio, PDFs with no obvious content → ctf-forensics (steganography)

**By keywords:**
- "buffer overflow", "ROP", "shellcode", "libc", "heap" → ctf-pwn
- "RSA", "AES", "cipher", "encrypt", "prime", "lattice", "LWE", "GCM" → ctf-crypto
- "XSS", "SQL", "injection", "cookie", "JWT", "SSRF" → ctf-web
- "disk image", "memory dump", "packet capture", "registry", "side-channel", "spectrogram" → ctf-forensics
- "find", "locate", "identify", "who", "where" → ctf-osint
- "obfuscated", "packed", "C2", "malware", "beacon" → ctf-malware
- "jail", "sandbox", "escape", "encoding", "signal", "game" → ctf-misc

**By service behavior:**
- Port with interactive prompt, crash on long input → ctf-pwn
- HTTP service → ctf-web
- netcat with math/crypto puzzles → ctf-crypto
- netcat with restricted shell or eval → ctf-misc (jail)

### Step 3: Apply Category Approach
Once categorized, apply the matching specialized workflow described in the skill instructions below.

### Step 4: Pivot When Stuck
1. Re-examine assumptions — is this really the category you think?
2. Try a different category — many challenges span multiple categories
3. Look for what you missed — hidden files, alternate ports, response headers, comments, metadata
4. Simplify — check for default creds, known CVEs, logic bugs
5. Check edge cases — off-by-one, race conditions, integer overflow, encoding mismatches

**Common multi-category patterns:**
- Forensics + Crypto: encrypted data in PCAP/disk image, need crypto to decrypt
- Web + Reverse: WASM or obfuscated JS in web challenge
- Web + Crypto: JWT forgery, custom MAC/signature schemes
- Reverse + Pwn: reverse the binary first, then exploit the vulnerability
- Misc + Crypto: jail escape requires building crypto primitives under constraints
- OSINT + Stego: social media posts with unicode homoglyph steganography
- Web + Forensics: paywall bypass reveals content hidden by CSS overlays

### Step 5: Generate Write-up
After solving, generate a concise writeup with: Summary (1-2 sentences), Solution steps, and Flag.

## Flag Formats
Common: \`flag{...}\`, \`FLAG{...}\`, \`CTF{...}\`, \`TEAM{...}\`
Custom prefixes: \`ENO{...}\`, \`HTB{...}\`, \`picoCTF{...}\`
Sometimes just a plaintext string with no wrapper.

When finding multiple flag-like strings, treat as candidates. Prefer the token tied to the intended artifact/workflow, not random noise or decoys.`,
};
