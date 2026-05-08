import type { SkillDef } from "../registry.js";

export const ctfReverseSkill: SkillDef = {
  name: "ctf-reverse",
  description: "Reverse engineering: analyze compiled, obfuscated, packed, or virtualized targets. Binaries, APKs, WASM, firmware, custom VMs, bytecode, anti-debug.",
  category: "ctf",
  userInvocable: false,
  content: () => `# CTF Reverse Engineering

## Workflow
1. **Start with strings extraction** — many easy challenges have plaintext flags
2. **Try dynamic analysis** — trace library calls, watch comparisons
3. **Hook comparison functions** — capture expected values without full reversing
4. **Try symbolic execution** — solves many flag-checkers automatically
5. **Map control flow** before modifying execution
6. **Automate manual processes** via scripting
7. **Validate assumptions** with multiple decompilers

## Key Techniques

### Comparison Direction (Critical!)
- \`transform(flag) == stored_target\` → reverse the transform
- \`transform(stored_target) == flag\` → flag IS the transformed data

### Memory Dumping
Let the program compute the answer, then dump it. Break at final comparison, enter any input of correct length, dump computed flag.

### Decoy Flag Detection
Multiple fake targets before real check. Set breakpoint at FINAL comparison, not earlier ones.

### Common Encryption Patterns
- XOR with single byte — try all 256 values
- XOR with known plaintext (\`flag{\`, \`CTF{\`)
- RC4 with hardcoded key
- Custom permutation + XOR
- XOR with position index (\`^ i\` or \`^ (i & 0xff)\`) layered with repeating key

### Anti-Debug Bypass
- Patch checks or use environments without debug detection
- Linux: ptrace, /proc, timing, signals, direct syscalls
- Windows: PEB, NtQueryInformationProcess, heap flags, TLS callbacks

### Custom VMs
- Map opcodes, trace execution, reconstruct control flow
- Look for dispatcher loop + jump table

### Packed Binaries
- Identify packer (UPX, Themida, VMProtect), unpack, then analyze
- Entry point jumps to unpacker stub → OEP after unpacking

### Quick Wins (Try First!)
- \`strings binary | grep -i flag\`
- \`ltrace ./binary\` / \`strace -f -s 500 ./binary\`
- Run with test inputs

## When to Pivot
- Binary understood, need to exploit → /ctf-pwn
- Recovering deleted files/PCAP → /ctf-forensics
- Core logic is crypto → /ctf-crypto
- Real malware sample → /ctf-malware
- Toy VM/encoding puzzle → /ctf-misc`,
};
