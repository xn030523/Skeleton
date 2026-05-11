import type { SkillDef } from "../registry.js";

export const ctfMiscSkill: SkillDef = {
  name: "ctf-misc",
  description: "Miscellaneous: Python/bash jails, encodings, esoteric languages, Z3 constraint solving, games/VMs, SDR/RF, privilege escalation, CTFd API.",
  category: "ctf",
  userInvocable: true,
  content: () => `# CTF Miscellaneous

## Key Techniques

### Python Jail / Sandbox Escape
- **Oracle pattern**: L() = length, Q(i,x) = compare, S(guess) = submit
- **Walrus bypass**: \`(abcdef := "new_chars")\` reassigns constraint vars
- **Decorator bypass**: \`@__import__\` + func.__class__.__dict__ for no-call escape
- **String join**: \`open(''.join(['fl','ag.txt'])).read()\` when \`+\` is blocked
- **f-string config injection**: store payload as config value, key named \`eval(stored_key)\`
- **Repunit decomposition**: decompose target into sum of repunits (1, 11, 111...) using only \`1\` and \`+\`
- **Quine context detection**: dual-purpose quine that prints itself and runs payload only in server process

### Bash Jail / Restricted Shell
- **HISTFILE trick**: \`HISTFILE=/flag /bin/bash && history\`
- **bash -v**: verbose mode prints file lines
- **ctypes.sh**: direct C library calls

### Encodings
- **Base64**: A-Za-z0-9+/= charset
- **Base32**: A-Z2-7= (no lowercase)
- **Hex**: 0-9a-fA-F
- **ROT13/18**: ROT13 letters + ROT5 digits
- **IEEE-754 float**: 32-bit float = 4 raw bytes → struct.pack('>f', val)
- **QR codes**: zbarimg, multi-layer, chunk reassembly
- **Nested archives**: recursive extraction loop

### Z3 Constraint Solving
\`\`\`python
from z3 import *
flag = [BitVec(f'f{i}', 8) for i in range(FLAG_LEN)]
s = Solver()
# Add constraints, check sat, extract model
\`\`\`

### Games / VMs
- **WASM patching**: wasm2wat → flip logic → wat2wasm
- **Cookie checkpoint**: save session cookies, restore on failure to brute-force
- **Flask cookie game state**: flask-unsign -d -c '<cookie>' leaks game answers
- **Brainfuck instrumentation**: track tape cells, brute-force character-by-character
- **De Bruijn sequences**: B(k,n) contains all k^n n-length strings

### SDR / RF Signal Processing
- **cf32**: np.complex64 | **cs16**: int16 reshape(-1,2) | **cu8**: RTL-SDR raw
- **QAM-16**: constellation mapping, carrier/timing recovery
- 4-fold ambiguity in carrier recovery — try 0/90/180/270 rotation

### Unicode Steganography
- **Variation Selectors** (U+E0100-U+E01EF): invisible chars encode ASCII via codepoint offset
- **Tag block** (U+E0000-U+E007F): subtract 0xE0000 to recover ASCII; render as zero-width
- **Homoglyph encoding**: visually-identical chars from different blocks encode binary (ASCII=0, homoglyph=1)

### Linux Privilege Escalation
- **sudo wildcard injection**: fnmatch() matches * across arg boundaries
- **Docker group**: mount host filesystem into container for root
- **SUID exploitation**: find / -perm -4000, check GTFObins
- **PostgreSQL RCE**: COPY (SELECT '') TO PROGRAM 'cmd'

### CTFd Platform API
- Detect CTFd, get token from Settings > Access Tokens
- List challenges, submit flags programmatically via API

## When to Pivot
- Pure cryptography → /ctf-crypto
- Real binary exploit → /ctf-pwn
- Files/images/audio need recovery → /ctf-forensics
- ML/AI techniques → /ctf-ai-ml`,
};
