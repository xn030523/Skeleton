import type { SkillDef } from "../registry.js";

export const ctfOsintSkill: SkillDef = {
  name: "ctf-osint",
  description: "Open source intelligence: social media, geolocation, DNS records, username enumeration, reverse image search, Google dorking, Wayback Machine.",
  category: "ctf",
  userInvocable: false,
  content: () => `# CTF OSINT

## Key Techniques

### Twitter/X Investigation
- Persistent numeric User ID: \`https://x.com/i/user/<id>\` works after renames
- **Snowflake timestamps**: \`(id >> 22) + 1288834974657\` = Unix milliseconds
- Wayback CDX, Nitter, memory.lol for historical data

### Image Analysis & Geolocation
- Google Lens (crop to region), TinEye, Yandex (faces)
- **Reflected text**: flip mirrored text, search with quotes
- **Railroad signs**: OpenRailwayMap, process of elimination
- **Plus Codes**: format XXXX+XXX, free Google Maps feature
- **MGRS coordinates**: convert to lat/long
- **Street View matching**: feature extraction + similarity ranking

### DNS Reconnaissance
- \`dig -t txt\`, zone transfers (\`dig axfr\`)
- Always check TXT, CNAME, MX for CTF domains

### Username OSINT
- whatsmyname.app (741+ sites), namechk.com

### Google Dorking
- \`site:\`, \`filetype:\`, \`intitle:\`
- **Image TBS filters**: \`&tbs=itp:face\` for face-only results

### Wayback Machine / Shodan
- CDX API for structured queries
- Shodan: device search, SSH fingerprint lookup

### Unicode Homoglyph Steganography
Visually-identical Unicode chars from different blocks encode binary data. ASCII=0, homoglyph=1, group bits into bytes for flag.

## When to Pivot
- Local file extraction → /ctf-forensics
- Active HTTP exploitation → /ctf-web
- Malware attribution → /ctf-malware`,
};
