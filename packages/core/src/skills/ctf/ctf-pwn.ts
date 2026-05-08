import type { SkillDef } from "../registry.js";

export const ctfPwnSkill: SkillDef = {
  name: "ctf-pwn",
  description: "Binary exploitation: buffer overflow, format string, heap, ROP, kernel, seccomp bypass, sandbox escape. Turn memory corruption into code execution.",
  category: "ctf",
  userInvocable: false,
  content: () => `# CTF Binary Exploitation (Pwn)

## Workflow
1. Check binary protections (NX, PIE, RELRO, canary, seccomp)
2. Identify vulnerability type (buffer overflow, format string, heap, UAF, race)
3. Develop exploit strategy based on protections
4. Build exploit, test, iterate

## Protection Decision Tree
- **Partial RELRO + No PIE** → GOT overwrite (easiest)
- **Full RELRO** → target hooks, return addresses
- **Canary present** → prefer heap attacks or leak canary first
- **NX enabled** → use ROP or ret2win

## Key Techniques

### Buffer Overflow
- Find offset with cyclic pattern
- ret2win, ROP chains
- Canary byte-by-byte brute force on forking servers (7*256 attempts max)
- Stack alignment: SIGSEGV in \`movaps\` = add extra \`ret\` gadget

### Format String
- Leak stack/GOT, overwrite GOT
- Blind pwn, filter bypass
- Single-call leak + GOT overwrite
- \`__printf_chk\` bypass with sequential \`%p\`

### ROP
- **ret2libc**: leak via \`puts@PLT(puts@GOT)\`, return to vuln, stage 2 with \`system("/bin/sh")\`
- **ret2csu**: \`__libc_csu_init\` gadgets control rdx/rsi/edi
- **Stack pivot**: \`xchg rax,esp\` when overflow is too small
- **SROP**: Sigreturn-Oriented Programming
- **Bad char XOR bypass**: XOR payload before writing to .data, XOR back in place
- **rdx control**: After \`puts()\`, rdx is clobbered to 1; use \`pop rdx; pop rbx; ret\` from libc

### Heap
- **tcache poisoning**, **fastbin attack**
- **House of Apple 2** (+ setcontext SUID variant)
- **House of Einherjar**, **House of Orange/Spirit/Lore/Force**
- **FSOP**: _IO_FILE vtable hijack for stdout
- **musl libc**: meta pointer + atexit hijack

### Kernel Exploitation
- **ret2usr**, **kernel ROP**, **modprobe_path**
- **tty_struct kROP**: fake vtable + stack pivot
- **userfaultfd** race stabilization
- **KASLR/FGKASLR bypass** via __ksymtab

### Seccomp Bypass
- **RETF architecture switch** (x64→x32)
- **openat/mmap/write** instead of open/read/write
- **x32 ABI syscall aliasing**

## When to Pivot
- Don't yet understand binary → /ctf-reverse
- Restricted shell/encoding → /ctf-misc
- Crypto primitive needed → /ctf-crypto
- Web endpoints matter more → /ctf-web`,
};
