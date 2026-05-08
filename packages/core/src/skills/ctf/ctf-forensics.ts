import type { SkillDef } from "../registry.js";

export const ctfForensicsSkill: SkillDef = {
  name: "ctf-forensics",
  description: "Digital forensics: disk images, memory dumps, PCAP, steganography, event logs, Volatility, Windows registry, side-channel analysis, data recovery.",
  category: "ctf",
  userInvocable: false,
  content: () => `# CTF Forensics

## Workflow
1. File identification — type, magic bytes, metadata
2. Carving — extract embedded/hidden files
3. Analysis — apply format-specific techniques
4. Reconstruction — reassemble fragments, decode hidden data

## Key Techniques

### Disk / Memory Forensics
- Mount images, Sleuth Kit (fls/icat), photorec for carving
- **Volatility 3**: pslist, cmdline, filescan, dumpfiles
- **GIMP raw memory dump**: open .dmp as raw RGB, scroll for framebuffer screenshots
- VM images: extract from OVA/VMDK, analyze registry/SAM

### Windows Forensics
- **Registry**: SAM hashes, autostart locations
- **Event logs**: 1001 (bugcheck), 1102 (audit cleared), 4720 (user created)
- **USN Journal**: file operation timeline when logs are cleared
- **PowerShell history**: ConsoleHost_history.txt
- **NTFS ADS**: hidden data streams

### PCAP / Network
- tshark filters, TLS decryption via SSLKEYLOGFILE
- **USB HID**: keyboard (keycode extraction), mouse (relative deltas)
- **dnscat2**: decode hex/base32 subdomain labels
- **NTLMv2**: extract from NTLMSSP_AUTH, brute-force

### Steganography
- **Binary border**: 1px border pixels encode bits clockwise
- **FFT**: np.fft.fft2 visualization for hidden frequency-domain data
- **DTMF**: multimon-ng -a DTMF
- **Multi-layer PDF**: hidden comments, post-EOF data, XOR with keywords
- **PNG chunk reorder**: IHDR → ancillary → IDAT → IEND
- **File overlays**: check after IEND for appended archives
- **JPEG DQT LSB**: unused quantization tables
- **BMP bitplane**: extract bitplanes per RGB channel (hidden QR often in bit 1)
- **F5 detection**: ±1 to ±2 ratio changes from ~3:1 to ~1:1
- **Autostereogram**: duplicate layer, difference blend, shift ~100px

### Audio / Video
- **SSTV + LSB**: SSTV may be red herring; check 2-bit LSB
- **FFT notes**: dominant frequencies → musical notes → text
- **DeepSound**: audio stego with password cracking
- **Video frame accumulation**: composite all frames to reveal hidden QR
- **Multi-track subtraction**: sox -m to cancel shared content

### Metadata
- EXIF (often hides flags!), document properties, file timestamps

## When to Pivot
- Encrypted blob needs crypto → /ctf-crypto
- C2/beacon config → /ctf-malware
- Web app backup/API dump → /ctf-web
- Recovered binary needs disassembly → /ctf-reverse`,
};
