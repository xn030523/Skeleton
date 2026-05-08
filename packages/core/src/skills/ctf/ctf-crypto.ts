import type { SkillDef } from "../registry.js";

export const ctfCryptoSkill: SkillDef = {
  name: "ctf-crypto",
  description: "Cryptography attacks: RSA, AES, ECC, lattice/LWE, PRNG, ZKP, classical ciphers. Number theory, Coppersmith, padding oracle, GCM attacks.",
  category: "ctf",
  userInvocable: false,
  content: () => `# CTF Cryptography

## Workflow
1. Identify cipher type (classical, block, stream, RSA, ECC, lattice, PRNG)
2. Gather parameters (n, e, key, IV, plaintext-ciphertext pairs)
3. Apply category-specific attack
4. Recover plaintext or forge signature

## Key Techniques

### Classical Ciphers
- **Caesar/ROT13**: brute force 26 keys
- **Vigenere**: Kasiski examination for key length; known-plaintext with flag format prefix
- **XOR**: frequency analysis per key position; try all 256 single-byte keys
- **OTP key reuse**: \`C1 XOR C2 XOR known_P = unknown_P\`; crib dragging
- **Atbash**: A↔Z substitution
- **Substitution**: frequency analysis, word patterns

### RSA Attacks
- **Small e**: take eth root when message is small
- **Common modulus**: extended GCD attack
- **Wiener**: small d (continued fractions)
- **Fermat**: p and q close together
- **Pollard p-1**: smooth p-1
- **Hastad broadcast**: same message, multiple e=3 encryptions
- **Coppersmith**: partially known prime; \`f.small_roots()\` in SageMath
- **Franklin-Reiter**: related messages with e=3
- **Bleichenbacher**: PKCS#1 v1.5 signature forgery with e=3
- **Partial key recovery** from dp/dq: iterate k, check if \`(dp*e-1)/k+1\` is prime
- **CRT fault attack**: \`gcd(s^e - m, n)\` reveals factor

### AES Attacks
- **ECB**: byte-at-a-time suffix recovery, cut-and-paste block manipulation
- **CBC**: bit flipping, padding oracle for decryption without key
- **GCM nonce reuse**: keystream reuse + GHASH key recovery via polynomial factoring
- **S-box collisions**: non-permutation S-box enables key recovery

### ECC Attacks
- **Small subgroup**: Pohlig-Hellman + CRT on small curve order factors
- **Invalid curve**: send points on weaker curves if validation missing
- **Smart's attack**: anomalous curves (order = p); p-adic lift
- **ECDSA/DSA nonce reuse**: same r in two signatures leaks private key

### Lattice / LWE
- **Quick triage**: modular linear equations + promise that hidden quantity is small → lattice candidate
- **LLL/BKZ/Babai**: start with LLL, upgrade to BKZ when LLL almost works
- **HNP**: partial/biased nonces reduce to Hidden Number Problem
- **Truncated LCG**: write each state as \`observed * 2^t + hidden\`, solve for corrections

### PRNG
- **MT19937**: untemper to recover state, predict future outputs
- **V8 XorShift128+**: recover state from 5-10 Math.random() outputs via Z3
- **LCG**: backward stepping via modular inverse

### ZKP & Constraints
- **Z3 solver**: BitVec for bit-level, Int for arbitrary precision
- **Graph 3-coloring**: \`nx.coloring.greedy_color(G)\`
- **Shamir SSS**: reused polynomial coefficients → subtract shares cancels randomness

## When to Pivot
- Understanding binary is blocker → /ctf-reverse
- Packet carving first → /ctf-forensics
- Implementing exploit after crypto → /ctf-pwn or /ctf-web`,
};
