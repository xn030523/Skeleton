import type { McpServerConfig } from "../config/index.js";
import type { BuiltinMcpServer } from "./types.js";

// ─── Static Analysis & Disassembly ───────────────────────────────────────────

const ghidraMcp: BuiltinMcpServer = {
  name: "ghidra-mcp",
  description: "Ghidra reverse engineering via MCP bridge (LaurieWired). 200+ tools: decompile, disassemble, rename, cross-ref, types. Requires Ghidra + plugin.",
  category: "static-analysis",
  config: {
    command: "python3",
    args: ["bridge_mcp_ghidra.py", "--transport", "stdio"],
    env: {},
  },
  envEnable: "SKELETON_MCP_GHIDRA",
  requiredEnv: ["GHIDRA_MCP_PATH"],
  optionalEnv: ["GHIDRA_SERVER_URL"],
};

const ghidraHeadlessMcp: BuiltinMcpServer = {
  name: "ghidra-headless-mcp",
  description: "Headless Ghidra MCP server (mrphrazer). Analyze binaries without GUI. Requires pyghidra + Ghidra install.",
  category: "static-analysis",
  config: {
    command: "python3",
    args: ["ghidra_headless_mcp.py"],
    env: {},
  },
  envEnable: "SKELETON_MCP_GHIDRA_HEADLESS",
  requiredEnv: ["GHIDRA_INSTALL_DIR"],
};

const reMcpGhidra: BuiltinMcpServer = {
  name: "re-mcp-ghidra",
  description: "Headless MCP for IDA Pro & Ghidra (jtsylve) — Ghidra backend. uvx-based, auto-manages Python env. Requires Ghidra 12+.",
  category: "static-analysis",
  config: {
    command: "uvx",
    args: ["re-mcp-ghidra"],
    env: {},
  },
  envEnable: "SKELETON_MCP_RE_GHIDRA",
  optionalEnv: ["GHIDRA_INSTALL_DIR"],
};

const reMcpIda: BuiltinMcpServer = {
  name: "re-mcp-ida",
  description: "Headless MCP for IDA Pro & Ghidra (jtsylve) — IDA backend. Requires IDA Pro 9+ license.",
  category: "static-analysis",
  config: {
    command: "uvx",
    args: ["re-mcp-ida"],
    env: {},
  },
  envEnable: "SKELETON_MCP_RE_IDA",
  requiredEnv: ["IDADIR"],
};

const radare2Mcp: BuiltinMcpServer = {
  name: "radare2-mcp",
  description: "radare2 MCP server (radareorg). 32 tools: disassembly, decompilation, analysis, strings. Requires radare2 6.1+.",
  category: "static-analysis",
  config: {
    command: "r2pm",
    args: ["-r", "r2mcp"],
    env: {},
  },
  envEnable: "SKELETON_MCP_RADARE2",
};

const idaMcp: BuiltinMcpServer = {
  name: "ida-mcp",
  description: "IDA Pro headless MCP server (blacktop/ida-mcp-rs). 388 stars, Rust binary. Requires IDA Pro 9.2+.",
  category: "static-analysis",
  config: {
    command: "ida-mcp",
    args: [],
    env: {},
  },
  envEnable: "SKELETON_MCP_IDA",
  optionalEnv: ["IDADIR", "DYLD_LIBRARY_PATH"],
};

const reversecoreMcp: BuiltinMcpServer = {
  name: "reversecore-mcp",
  description: "Combined Ghidra + radare2 + YARA orchestration MCP (Reversecore). Docker-based. Requires Ghidra 11.4.3 + JDK 17.",
  category: "static-analysis",
  config: {
    command: "docker",
    args: ["run", "-i", "--rm", "-v", "${REVERSECORE_WORKSPACE:-/tmp/re}:/app/workspace", "-e", "MCP_TRANSPORT=stdio", "reversecore-mcp:latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_REVERSECORE",
  requiredEnv: ["REVERSECORE_WORKSPACE"],
  optionalEnv: ["GHIDRA_INSTALL_DIR"],
};

const jadxMcp: BuiltinMcpServer = {
  name: "jadx-mcp",
  description: "JADX Android decompiler MCP server. Decompile APK/DEX/Class files to Java source.",
  category: "static-analysis",
  config: {
    command: "uvx",
    args: ["jadx-mcp-server"],
    env: {},
  },
  envEnable: "SKELETON_MCP_JADX",
};

const rbinmcp: BuiltinMcpServer = {
  name: "rbinmcp",
  description: "Docker-based multi-tool binary analysis: radare2 + ILSpy + Ghidra. Analyze PE/ELF/DEX in container.",
  category: "static-analysis",
  config: {
    command: "docker",
    args: ["run", "-i", "--rm", "-v", "${RBIN_DATA:-/tmp/bins}:/data:ro", "rbinmcp:latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_RBINMCP",
};

// ─── Dynamic Analysis & Debugging ───────────────────────────────────────────

const x64dbgMcp: BuiltinMcpServer = {
  name: "x64dbg-mcp",
  description: "x64dbg debugger MCP server (152 tools): breakpoints, memory r/w, step, trace, registers, modules. Windows only.",
  category: "dynamic-analysis",
  config: {
    command: "python",
    args: ["x64dbg_mcp_server.py"],
    env: {},
  },
  envEnable: "SKELETON_MCP_X64DBG",
  platform: ["win32"],
  requiredEnv: ["X64DBG_PATH"],
};

const fridaMcp: BuiltinMcpServer = {
  name: "frida-mcp",
  description: "Frida dynamic instrumentation MCP server (dnakov). Hook functions, trace calls, dump memory. Requires frida pip package.",
  category: "dynamic-analysis",
  config: {
    command: "frida-mcp",
    args: [],
    env: {},
  },
  envEnable: "SKELETON_MCP_FRIDA",
};

const nexuscoreMcp: BuiltinMcpServer = {
  name: "nexuscore-mcp",
  description: "AI-powered dynamic malware analysis with Frida instrumentation (46+ tools). Rust binary. Optional CAPE sandbox integration.",
  category: "dynamic-analysis",
  config: {
    command: "nexuscore_mcp",
    args: [],
    env: {},
  },
  envEnable: "SKELETON_MCP_NEXUSCORE",
  optionalEnv: ["CAPE_API_URL", "CAPE_API_TOKEN"],
};

const kahloMcp: BuiltinMcpServer = {
  name: "kahlo-mcp",
  description: "Frida MCP server for autonomous Android instrumentation (FuzzySecurity). Hook Java/native, trace SSL, dump dex.",
  category: "dynamic-analysis",
  config: {
    command: "uvx",
    args: ["kahlo-mcp"],
    env: {},
  },
  envEnable: "SKELETON_MCP_KAHLO",
};

const cheatengineMcp: BuiltinMcpServer = {
  name: "cheatengine-mcp",
  description: "Cheat Engine MCP bridge. Memory scanning, pointer scanning, Lua scripting. Windows only.",
  category: "dynamic-analysis",
  config: {
    command: "python",
    args: ["-m", "cheatengine_mcp"],
    env: {},
  },
  envEnable: "SKELETON_MCP_CHEATENGINE",
  platform: ["win32"],
};

const safiyeMonitor: BuiltinMcpServer = {
  name: "safiye-monitor",
  description: "Network traffic monitor MCP. Intercept HTTP/HTTPS, SSL pinning bypass, API replay. Android/iOS focus.",
  category: "dynamic-analysis",
  config: {
    command: "uvx",
    args: ["safiye-monitor"],
    env: {},
  },
  envEnable: "SKELETON_MCP_SAFIYE",
};

// ─── Malware & Threat Analysis ──────────────────────────────────────────────

const yaraMcp: BuiltinMcpServer = {
  name: "yara-mcp",
  description: "YARA pattern matching MCP server (7 tools): scan files, manage rules, match classification. Requires yara binary.",
  category: "malware",
  config: {
    command: "uvx",
    args: ["yara-mcp"],
    env: {},
  },
  envEnable: "SKELETON_MCP_YARA",
};

const capaMcp: BuiltinMcpServer = {
  name: "capa-mcp",
  description: "MITRE ATT&CK capability detection MCP (5 tools). Identify TTPs in executables. Requires capa binary.",
  category: "malware",
  config: {
    command: "uvx",
    args: ["capa-mcp"],
    env: {},
  },
  envEnable: "SKELETON_MCP_CAPA",
};

const binwalkMcp: BuiltinMcpServer = {
  name: "binwalk-mcp",
  description: "Firmware analysis MCP (6 tools): signature scan, entropy, extraction, carve. Requires binwalk.",
  category: "malware",
  config: {
    command: "uvx",
    args: ["binwalk-mcp-server"],
    env: {},
  },
  envEnable: "SKELETON_MCP_BINWALK",
};

const virustotalMcp: BuiltinMcpServer = {
  name: "virustotal-mcp",
  description: "VirusTotal threat intelligence MCP. Scan hashes, URLs, files. Requires VT API key.",
  category: "malware",
  config: {
    command: "uvx",
    args: ["mcp-virustotal"],
    env: {},
  },
  envEnable: "SKELETON_MCP_VIRUSTOTAL",
  requiredEnv: ["VT_API_KEY"],
};

// ─── Security Audit & Pentesting ────────────────────────────────────────────

const nmapMcp: BuiltinMcpServer = {
  name: "nmap-mcp",
  description: "Nmap port scanning MCP (8 tools): scan, service detection, OS fingerprint, NSE scripts. Docker-based, needs NET_RAW.",
  category: "security-audit",
  config: {
    command: "docker",
    args: ["run", "-i", "--rm", "--cap-add=NET_RAW", "nmap-mcp:latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_NMAP",
};

const nucleiMcp: BuiltinMcpServer = {
  name: "nuclei-mcp",
  description: "Nuclei vulnerability scanner MCP (7 tools): 8000+ templates, CVE scanning, custom workflows. Docker-based.",
  category: "security-audit",
  config: {
    command: "docker",
    args: ["run", "-i", "--rm", "nuclei-mcp:latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_NUCLEI",
};

const sqlmapMcp: BuiltinMcpServer = {
  name: "sqlmap-mcp",
  description: "SQLMap SQL injection MCP (8 tools): detect and exploit SQLi. Docker-based.",
  category: "security-audit",
  config: {
    command: "docker",
    args: ["run", "-i", "--rm", "sqlmap-mcp:latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_SQLMAP",
};

const ffufMcp: BuiltinMcpServer = {
  name: "ffuf-mcp",
  description: "FFUF web fuzzer MCP (9 tools): dirs, files, params, vhosts. Docker-based.",
  category: "security-audit",
  config: {
    command: "docker",
    args: ["run", "-i", "--rm", "ffuf-mcp:latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_FFUF",
};

const hashcatMcp: BuiltinMcpServer = {
  name: "hashcat-mcp",
  description: "Hashcat password cracking MCP. Natural language hash cracking, attack mode selection. Docker-based.",
  category: "security-audit",
  config: {
    command: "docker",
    args: ["run", "-i", "--rm", "hashcat-mcp:latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_HASHCAT",
};

const searchsploitMcp: BuiltinMcpServer = {
  name: "searchsploit-mcp",
  description: "Exploit-DB search MCP (5 tools): search exploits, shellcodes, list by platform/version. Docker-based.",
  category: "security-audit",
  config: {
    command: "docker",
    args: ["run", "-i", "--rm", "-v", "exploitdb-data:/opt/exploitdb", "searchsploit-mcp:latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_SEARCHSPLOIT",
};

const semgrepMcp: BuiltinMcpServer = {
  name: "semgrep-mcp",
  description: "Semgrep static code analysis MCP (7 tools): 5000+ rules, SAST, custom patterns. Docker-based.",
  category: "security-audit",
  config: {
    command: "docker",
    args: ["run", "-i", "--rm", "semgrep-mcp:latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_SEMGREP",
  optionalEnv: ["SEMGREP_APP_TOKEN"],
};

const bloodhoundMcp: BuiltinMcpServer = {
  name: "bloodhound-mcp",
  description: "BloodHound AD attack path analysis MCP (75+ tools): Cypher queries, pathfinding, node search. Docker-based.",
  category: "security-audit",
  config: {
    command: "docker",
    args: ["run", "-i", "--rm", "bloodhound-mcp:latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_BLOODHOUND",
};

const burpMcp: BuiltinMcpServer = {
  name: "burp-mcp",
  description: "Burp Suite MCP integration. Proxy, scanner, repeater, intruder control. Requires running Burp with REST API.",
  category: "security-audit",
  config: {
    command: "uvx",
    args: ["mcp-burp"],
    env: {},
  },
  envEnable: "SKELETON_MCP_BURP",
  optionalEnv: ["BURP_API_URL", "BURP_API_KEY"],
};

const masscanMcp: BuiltinMcpServer = {
  name: "masscan-mcp",
  description: "Masscan high-speed port scanning MCP (6 tools). For large network sweeps. Docker-based, needs NET_RAW.",
  category: "security-audit",
  config: {
    command: "docker",
    args: ["run", "-i", "--rm", "--cap-add=NET_RAW", "masscan-mcp:latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_MASSCAN",
};

const boofuzzMcp: BuiltinMcpServer = {
  name: "boofuzz-mcp",
  description: "boofuzz network protocol fuzzer MCP (4 tools). Grammar-based fuzzing, crash monitoring. Docker-based.",
  category: "security-audit",
  config: {
    command: "docker",
    args: ["run", "-i", "--rm", "boofuzz-mcp:latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_BOOFUZZ",
};

const gitleaksMcp: BuiltinMcpServer = {
  name: "gitleaks-mcp",
  description: "Gitleaks secrets detection MCP (5 tools). Find API keys, tokens, credentials in repos and files. Docker-based.",
  category: "security-audit",
  config: {
    command: "docker",
    args: ["run", "-i", "--rm", "-v", "${GITLEAKS_TARGET:-/tmp/repos}:/app/target:ro", "gitleaks-mcp:latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_GITLEAKS",
};

// ─── Blockchain Security ─────────────────────────────────────────────────────

const solazyMcp: BuiltinMcpServer = {
  name: "solazy-mcp",
  description: "Solana sBPF static analysis & reverse engineering MCP (8 tools). Disassemble, decompile Solana programs.",
  category: "blockchain",
  config: {
    command: "uvx",
    args: ["solazy-mcp"],
    env: {},
  },
  envEnable: "SKELETON_MCP_SOLAZY",
};

const medusaMcp: BuiltinMcpServer = {
  name: "medusa-mcp",
  description: "Medusa smart contract fuzzer MCP (4 tools). Fuzz Solidity contracts, find vulnerabilities. Docker-based.",
  category: "blockchain",
  config: {
    command: "docker",
    args: ["run", "-i", "--rm", "medusa-mcp:latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_MEDUSA",
};

// ─── Cloud Security ──────────────────────────────────────────────────────────

const trivyMcp: BuiltinMcpServer = {
  name: "trivy-mcp",
  description: "Trivy container/filesystem/IaC vulnerability scanner MCP (7 tools). CVE detection, SBOM generation.",
  category: "cloud",
  config: {
    command: "npx",
    args: ["-y", "trivy-mcp"],
    env: {},
  },
  envEnable: "SKELETON_MCP_TRIVY",
};

const prowlerMcp: BuiltinMcpServer = {
  name: "prowler-mcp",
  description: "Prowler AWS/Azure/GCP security audit MCP (6 tools). Compliance checks, CIS benchmarks. Docker-based.",
  category: "cloud",
  config: {
    command: "docker",
    args: ["run", "-i", "--rm", "prowler-mcp:latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_PROWLER",
  optionalEnv: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
};

const roadreconMcp: BuiltinMcpServer = {
  name: "roadrecon-mcp",
  description: "Azure AD enumeration MCP (6 tools). Dump users, groups, policies via ROADrecon. Docker-based.",
  category: "cloud",
  config: {
    command: "docker",
    args: ["run", "-i", "--rm", "roadrecon-mcp:latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_ROADRECON",
  optionalEnv: ["AZURE_TOKEN"],
};

// ─── Digital Forensics ───────────────────────────────────────────────────────

const dfireballzMcp: BuiltinMcpServer = {
  name: "dfireballz-mcp",
  description: "Digital forensics MCP suite (7 servers): disk imaging, file carving, timeline analysis, registry, memory forensics. Docker-based.",
  category: "forensics",
  config: {
    command: "docker",
    args: ["run", "-i", "--rm", "-v", "${DFIRE_DATA:-/tmp/evidence}:/evidence:ro", "dfireballz-mcp:latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_DFIREBALLZ",
};

// ─── Open-Source Intelligence ────────────────────────────────────────────────

const maigretMcp: BuiltinMcpServer = {
  name: "maigret-mcp",
  description: "Maigret username OSINT MCP. Search 2500+ sites for username presence, profile data. Docker-based.",
  category: "osint",
  config: {
    command: "docker",
    args: ["run", "-i", "--rm", "maigret-mcp:latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_MAIGRET",
};

const shodanMcp: BuiltinMcpServer = {
  name: "shodan-mcp",
  description: "Shodan internet scanning MCP. Search hosts, services, vulnerabilities. Requires Shodan API key.",
  category: "osint",
  config: {
    command: "uvx",
    args: ["mcp-shodan"],
    env: {},
  },
  envEnable: "SKELETON_MCP_SHODAN",
  requiredEnv: ["SHODAN_API_KEY"],
};

const otxMcp: BuiltinMcpServer = {
  name: "otx-mcp",
  description: "AlienVault OTX threat intelligence MCP. Pulse search, indicator lookup, adversarial analysis. Docker-based.",
  category: "osint",
  config: {
    command: "docker",
    args: ["run", "-i", "--rm", "otx-mcp:latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_OTX",
  optionalEnv: ["OTX_API_KEY"],
};

// ─── Browser Instrumentation ─────────────────────────────────────────────────

const jshookMcp: BuiltinMcpServer = {
  name: "jshook",
  description: "Browser instrumentation: 387 tools across 36 domains (debugger, hooks, memory, wasm, v8-inspector, network, trace). Run via npx.",
  category: "browser",
  config: {
    command: "npx",
    args: ["-y", "@jshookmcp/jshook@latest"],
    env: { JSHOOK_BASE_PROFILE: "search" },
  },
  envEnable: "SKELETON_MCP_JSHOOK",
};

const playwrightMcp: BuiltinMcpServer = {
  name: "playwright-mcp",
  description: "Microsoft Playwright MCP (32k stars). Browser automation, screenshot, click, fill, network intercept, JS eval. Headless/headed.",
  category: "browser",
  config: {
    command: "npx",
    args: ["@playwright/mcp@latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_PLAYWRIGHT",
  optionalEnv: ["PLAYWRIGHT_MCP_BROWSER", "PLAYWRIGHT_MCP_HEADLESS"],
};

const chromeDevtoolsMcp: BuiltinMcpServer = {
  name: "chrome-devtools-mcp",
  description: "Chrome DevTools MCP (30 stars). AI-powered Chrome automation with natural language element detection, performance, network.",
  category: "browser",
  config: {
    command: "npx",
    args: ["-y", "chrome-devtools-mcp@latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_CHROME_DEVTOOLS",
  optionalEnv: ["CHROME_PATH"],
};

const rcDevtoolsMcp: BuiltinMcpServer = {
  name: "rc-devtools-mcp",
  description: "Browser debugging & reverse engineering MCP (reverse-craft). CDP access, breakpoints, JS eval, network monitoring, headless support.",
  category: "browser",
  config: {
    command: "npx",
    args: ["@reverse-craft/rc-devtools-mcp@latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_RC_DEVTOOLS",
};

const cdpToolsMcp: BuiltinMcpServer = {
  name: "cdp-tools-mcp",
  description: "Chrome DevTools Protocol MCP (8 stars). Set breakpoints, inspect variables, monitor network, evaluate JS in Chrome/Node.",
  category: "browser",
  config: {
    command: "npx",
    args: ["-y", "cdp-tools-mcp@latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_CDP_TOOLS",
};

const firefoxDevtoolsMcp: BuiltinMcpServer = {
  name: "firefox-devtools-mcp",
  description: "Firefox DevTools MCP (147 stars, Mozilla official). Browser inspection, console, network, JS eval via Marionette protocol.",
  category: "browser",
  config: {
    command: "npx",
    args: ["-y", "firefox-devtools-mcp@latest"],
    env: {},
  },
  envEnable: "SKELETON_MCP_FIREFOX_DEVTOOLS",
  optionalEnv: ["FIREFOX_HEADLESS", "START_URL"],
};

const flowlensMcp: BuiltinMcpServer = {
  name: "flowlens-mcp",
  description: "FlowLens browser context MCP (104 stars). Full browser context for coding agents — see DOM, network, console flows. Chrome extension.",
  category: "browser",
  config: {
    command: "flowlens-mcp-server",
    args: [],
    env: {},
  },
  envEnable: "SKELETON_MCP_FLOWLENS",
  optionalEnv: ["FLOWLENS_MCP_TOKEN"],
};

// ─── Web Reverse Engineering ─────────────────────────────────────────────────

const webReversingMcp: BuiltinMcpServer = {
  name: "web-reversing-mcp",
  description: "Web recon, JS/WASM reversing & vuln scanning MCP (drvcvt). Integrates subfinder, httpx, nuclei, ffuf, sqlmap, webcrack. Graceful degradation.",
  category: "web-reverse",
  config: {
    command: "python3",
    args: ["server.py"],
    env: {},
  },
  envEnable: "SKELETON_MCP_WEB_REVERSING",
  requiredEnv: ["WEB_REVERSING_PATH"],
};

const mitmproxyMcp: BuiltinMcpServer = {
  name: "mitmproxy-mcp",
  description: "mitmproxy MCP — analyze, intercept, replay HTTP/HTTPS traffic. SSL pinning bypass, request tampering, API replay. Requires mitmproxy 10+.",
  category: "web-reverse",
  config: {
    command: "mitmdump",
    args: ["-s", "addon.py", "--set", "mcp_transport=stdio"],
    env: {},
  },
  envEnable: "SKELETON_MCP_MITMPROXY",
  requiredEnv: ["MITMPROXY_MCP_PATH"],
};

const apiTesterMcp: BuiltinMcpServer = {
  name: "api-tester-mcp",
  description: "Postman-grade HTTP API testing MCP. Send requests, inspect responses, test REST/GraphQL endpoints, auth flows.",
  category: "web-reverse",
  config: {
    command: "uvx",
    args: ["api-tester-mcp"],
    env: {},
  },
  envEnable: "SKELETON_MCP_API_TESTER",
};

// ─── Master list ─────────────────────────────────────────────────────────────

export const BUILTIN_MCP_SERVERS: BuiltinMcpServer[] = [
  // Static Analysis
  ghidraMcp,
  ghidraHeadlessMcp,
  reMcpGhidra,
  reMcpIda,
  radare2Mcp,
  idaMcp,
  reversecoreMcp,
  jadxMcp,
  rbinmcp,
  // Dynamic Analysis
  x64dbgMcp,
  fridaMcp,
  nexuscoreMcp,
  kahloMcp,
  cheatengineMcp,
  safiyeMonitor,
  // Malware
  yaraMcp,
  capaMcp,
  binwalkMcp,
  virustotalMcp,
  // Security Audit
  nmapMcp,
  nucleiMcp,
  sqlmapMcp,
  ffufMcp,
  hashcatMcp,
  searchsploitMcp,
  semgrepMcp,
  bloodhoundMcp,
  burpMcp,
  masscanMcp,
  boofuzzMcp,
  gitleaksMcp,
  // Blockchain
  solazyMcp,
  medusaMcp,
  // Cloud
  trivyMcp,
  prowlerMcp,
  roadreconMcp,
  // Forensics
  dfireballzMcp,
  // OSINT
  maigretMcp,
  shodanMcp,
  otxMcp,
  // Browser
  jshookMcp,
  playwrightMcp,
  chromeDevtoolsMcp,
  rcDevtoolsMcp,
  cdpToolsMcp,
  firefoxDevtoolsMcp,
  flowlensMcp,
  // Web Reverse Engineering
  webReversingMcp,
  mitmproxyMcp,
  apiTesterMcp,
];
