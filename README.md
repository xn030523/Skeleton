<p align="center">
  <img src="assets/banner.svg" alt="Skeleton" width="100%">
</p>

<p align="center">
  <a href="https://github.com/your-org/skeleton/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License: MIT"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node-%3E%3D22-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node"></a>
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/pnpm-10-F69220?style=for-the-badge&logo=pnpm&logoColor=white" alt="pnpm">
  <img src="https://img.shields.io/badge/Providers-34-FFD700?style=for-the-badge" alt="34 Providers">
  <img src="https://img.shields.io/badge/Commands-66%2B-8A2BE2?style=for-the-badge" alt="66+ Slash Commands">
  <a href="README_CN.md"><img src="https://img.shields.io/badge/Lang-中文-red?style=for-the-badge" alt="中文"></a>
</p>

**The self-improving reverse engineering AI agent.** Skeleton is a full-stack TypeScript agent framework with a learning loop baked in — auto-curated memory across sessions, sub-agent delegation, cron scheduling, MCP host with 50+ pre-wired security tools, a CTF skills library, and a closed feedback loop that persists findings (vulnerabilities, offsets, algorithms, keys) into a SQLite + FTS5 knowledge store and injects them back into every turn. Talk to it from the terminal or from Telegram — same brain, same memory.

Use any model — 34 pre-configured providers covering [OpenAI](https://openai.com), [Anthropic](https://anthropic.com), [Gemini](https://ai.google.dev), [Azure](https://azure.microsoft.com), [Bedrock](https://aws.amazon.com/bedrock), [Fireworks](https://fireworks.ai), [OpenRouter](https://openrouter.ai), [Together](https://together.ai), [Groq](https://groq.com), [Cerebras](https://cerebras.ai), [DeepSeek](https://deepseek.com), [Qwen](https://qwen.ai), [Kimi](https://kimi.com), [MiniMax](https://minimax.io), [Xiaomi](https://platform.xiaomimimo.com), [xAI](https://x.ai), [NVIDIA NIM](https://build.nvidia.com), [Hugging Face](https://huggingface.co), [Nous](https://nousresearch.com), [GitHub Copilot](https://github.com/features/copilot), local [vLLM](https://github.com/vllm-project/vllm) / [Ollama](https://ollama.ai) / [LM Studio](https://lmstudio.ai), and anything OpenAI/Anthropic-compatible. Four transports (Chat Completions, Anthropic Messages, Codex Responses, Bedrock Converse) share a single agent loop — switch with a config key, no code changes.

**Why "Skeleton"?** Like a skeleton key, it opens any lock. Like skeletal reduction in reverse engineering, it strips obfuscation layer by layer until the bones are bare.

<table>
<tr><td width="180"><b>A closed learning loop</b></td><td>Five memory layers: classic MemoryStore (FTS5), WorkingMemory (task-scoped), HonchoUserModel (dialectic user profile with hypotheses/reconcile), HolographicMemory (HRR vectors), UserProfile. Auto-extraction scans every turn for RE-specific findings, deduplicates by prefix, ranks by <code>use_count</code>, and injects the top memories back into the system prompt each turn. Optional Mem0 plugin bridge.</td></tr>
<tr><td><b>A real terminal interface</b></td><td>Ink + React 19 TUI with streaming token output, spinner, syntax-highlighted markdown (marked + cli-highlight), theming (5 skins), status bar (3 densities), multi-language UI (9 locales), and a readline fallback. 66+ slash commands, autocomplete, history, interrupt/redirect.</td></tr>
<tr><td><b>Lives where you do</b></td><td>CLI and Telegram gateway — same memory, same sessions, same skills. One SQLite file backs both. Set <code>SKELETON_TG_TOKEN</code> and you're live on Telegram in one command. Grammy-powered bot with whitelist, group mode (off / mention / all), and emoji reactions.</td></tr>
<tr><td><b>Skills &amp; CTF library</b></td><td>Skill Registry with hub sync, lifecycle tracking, curator (dedupe / orphan cleanup), guard (risk scanning), provenance tracking, and usage counters. Bundled CTF library: a <code>solve-challenge</code> orchestrator plus 16 category workflows (pwn, web, crypto, reverse, forensics, misc, osint, malware, ai-ml, js-deobfuscation, wasm-reverse, api-reverse, bundle-analysis, chrome-extension-audit, anti-bot-bypass, writeup).</td></tr>
<tr><td><b>Delegates and parallelizes</b></td><td>Sub-agent spawning (serial and parallel). Goals / Ralph Loop for long-running objectives. Mixture-of-Agents (MoA) and parallel tool calls (PTC). Auxiliary model router splits work across specialist endpoints (compression, vision, web-extract, title, session-search, skills-hub, MCP, judge, error-classifier).</td></tr>
<tr><td><b>MCP host, 50+ tools pre-wired</b></td><td>Built-in MCP host with OAuth support. 50+ curated server definitions covering Ghidra, IDA Pro, radare2, Frida, JADX, x64dbg, Cheat Engine, YARA, capa, binwalk, VirusTotal, nmap, nuclei, sqlmap, ffuf, hashcat, BloodHound, Burp, Semgrep, Trivy, Prowler, Playwright, Chrome DevTools, Firefox DevTools, Maigret, Shodan, jshookmcp (387 browser tools), and more. Enable any of them with a yaml key or env flag.</td></tr>
<tr><td><b>Automations</b></td><td>Cron scheduler with its own parser, store, and delivery tools. Background task manager (spawn / list / kill / get). Hook registry with 7 events (pre/post tool, pre/post LLM, session start/stop, on error). Plugin system with lifecycle and context injection.</td></tr>
<tr><td><b>Runs beyond your laptop</b></td><td>Four sandbox backends: Daytona, Modal, Singularity, Vercel Sandbox. Execute commands, write files, and keep agent state hibernating between sessions. Includes checkpoint manager (git-backed history in <code>.skeleton/checkpoints/</code>) and snapshot manager (create / restore / list / prune).</td></tr>
<tr><td><b>Research-ready</b></td><td>Trajectory compressor, batch runner, RL trainer with reward configs, 8 model-specific tool-call parsers (Hermes, Mistral, Qwen, DeepSeek V3/V3.1, LLaMA, GLM, Kimi K2) for fine-tuning tool-using models.</td></tr>
</table>

---

## Quick Install

```bash
git clone https://github.com/your-org/skeleton.git
cd skeleton
pnpm install
```

> **Prerequisites:** [Node.js](https://nodejs.org) >= 22 and [pnpm](https://pnpm.io) 10+ (or use `npx pnpm`).

Create `.env` in the project root:

```bash
SKELETON_PROTOCOL=anthropic
SKELETON_API_KEY=sk-ant-...
SKELETON_BASE_URL=https://api.anthropic.com
SKELETON_MODEL=claude-sonnet-4-5-20250514
```

Or use `skeleton.yaml` / `~/.skeleton/config.yaml` with provider-based configuration:

```yaml
llm:
  provider: deepseek        # auto-resolves baseUrl, env var, default model
  model: deepseek-chat
fallback:
  provider: anthropic       # used if primary fails
  model: claude-sonnet-4-20250514
```

Start chatting:

```bash
npm run cli
```

> **Base URL rule:** Set the URL up to but **not including** `/v1`. The SDK appends it automatically.
>
> | Provider | Protocol | Base URL |
> |---|---|---|
> | OpenAI | openai | `https://api.openai.com` |
> | Anthropic | anthropic | `https://api.anthropic.com` |
> | Fireworks AI | anthropic | `https://api.fireworks.ai/inference` |
> | OpenRouter | openai | `https://openrouter.ai/api` |
> | Together AI | openai | `https://api.together.xyz` |
> | Groq | openai | `https://api.groq.com/openai` |
> | DeepSeek | openai | `https://api.deepseek.com` |
> | Local vLLM | openai | `http://localhost:8000` |
> | Ollama | openai | `http://localhost:11434` |
> | LM Studio | openai | `http://localhost:1234` |

---

## Getting Started

```bash
npm run cli                                                    # Interactive REPL
npx tsx packages/cli/src/bin.ts "analyze this: mov eax, [ebp+8]"  # One-shot streaming query
npm run tg                                                     # Start Telegram gateway
npm run build                                                  # Build all packages
```

## CLI vs Telegram Quick Reference

Skeleton has two entry points: the terminal UI via `npm run cli`, or the Telegram gateway via `npm run tg`. Once you're in a conversation, the 66+ slash commands are shared across both.

| Action | CLI | Telegram |
|--------|-----|----------|
| Start chatting | `npm run cli` | Set `SKELETON_TG_TOKEN`, run `npm run tg`, message the bot |
| Start fresh conversation | `/new` | `/new` |
| Reset conversation | `/reset` | `/reset` |
| Change model | `/model [provider:model]` | `/model` |
| Set personality | `/personality [name]` | `/personality` |
| Retry / undo last turn | `/retry`, `/undo` | `/retry`, `/undo` |
| Branch conversation | `/branch`, `/resume` | `/branch` |
| Checkpoint / snapshot | `/snapshot`, `/rollback` | `/snapshot` |
| Compress / usage / insights | `/compress`, `/usage`, `/insights` | `/compress`, `/usage`, `/insights` |
| View / save / forget memories | `/memory`, `/remember`, `/forget` | same |
| Search past sessions | `/search <query>`, `/sessions` | `/search` |
| Skills / tools / toolsets | `/skills`, `/tools`, `/toolsets` | same |
| MCP servers | `/mcp`, `/reload-mcp` | `/mcp` |
| Long-running goal loop | `/goal`, `/agents`, `/queue` | `/goal` |
| Sub-agent delegation | `/agents` | `/agents` |
| Cron automations | `/cron` | `/cron` |
| Background tasks | `/bg`, `/stop` | `/bg` |
| Honcho user model | `/honcho`, `/profile` | `/honcho` |
| Trajectory export | `/trajectory` | `/trajectory` |
| UI — skin / status bar / footer / indicator | `/skin`, `/statusbar`, `/footer`, `/indicator` | — |
| Language (9 locales) | `/lang` | `/lang` |
| Voice mode | `/voice` | — |
| Clipboard | `/copy`, `/paste` | — |
| Diagnostics / debug report / update | `/doctor` (CLI binary), `/debug`, `/update` | `/debug` |
| Interrupt | `Ctrl+C` or send a new message | `/stop` or send a new message |
| Help / exit | `/help`, `/quit` | `/help` |

---

## Architecture

```
 ┌─────────────────┐        ┌──────────────────┐
 │  @skeleton/cli  │        │  @skeleton/tg    │
 │  (Ink + React)  │        │  (Grammy bot)    │
 └────────┬────────┘        └────────┬─────────┘
          │                          │
          └──────────────┬───────────┘
                         │
                ┌────────▼────────┐
                │   Agent Loop    │  goals · sub-agents · hooks · plugins
                │  (fallback /    │  MoA · PTC · auxiliary-router · cron
                │   tool / turn)  │
                └────────┬────────┘
                         │
    ┌────────────────────┼────────────────────┬────────────────┐
    │                    │                    │                │
┌───▼────────┐  ┌────────▼────────┐  ┌────────▼────────┐  ┌───▼────────┐
│  Memory    │  │   Session DB    │  │  Tool Registry  │  │ MCP Host   │
│  5 layers  │  │   SQLite + WAL  │  │  11 built-in +  │  │  50+ pre-  │
│  FTS5 +    │  │   + FTS5 search │  │  sandbox tools  │  │  wired     │
│  HRR + Mem0│  │   + checkpoints │  │  + toolsets     │  │  servers   │
└────────────┘  └─────────────────┘  └─────────────────┘  └────────────┘
                         │
              ┌──────────▼──────────┐
              │   Transport Layer   │
              └──────────┬──────────┘
                         │
        ┌───────────┬────┴────┬─────────────┐
        ▼           ▼         ▼             ▼
    OpenAI    Anthropic   Codex          Bedrock
    Chat      Messages    Responses      Converse
    Completions (+cache)  API            API
```

| Package | What it does |
|---|---|
| `@skeleton/core` | Agent engine — 4 transports, 34 provider profiles, 5 memory layers, session DB, tool registry, MCP host, skills/CTF library, goals, sub-agents, hooks, plugins, cron, 4 sandbox backends, 8 tool-call parsers, config loader, context compressor, auxiliary router |
| `@skeleton/cli` | Terminal TUI — Ink + React 19 chat UI with streaming, marked + cli-highlight markdown rendering, 5 skins, 3 status-bar densities, readline fallback, doctor / setup commands |
| `@skeleton/tg` | Telegram gateway — Grammy bot sharing memory + sessions with CLI, group modes, whitelist, emoji reactions, MDv2 rendering with table conversion and think-block filtering |

---

## Memory System

Skeleton's memory is a **closed learning loop** — not a chat log, but five layers of persistent knowledge that make the agent sharper every session:

1. **MemoryStore** (`.skeleton/memory.db`) — SQLite + FTS5 with unicode61 tokenization. Auto-extraction scans every response for RE-specific keywords (`vulnerability`, `exploit`, `offset`, `address`, `function`, `algorithm`, `key`, `decrypt`, `encrypt`, `hash`, `struct`, `protocol`, `format`, `header`, and CJK equivalents `漏洞`, `偏移`, `地址`, `函数`, `算法`, `密钥`, `加密`). Deduplication by 40-character prefix prevents knowledge rot.
2. **WorkingMemory** — task-scoped scratchpad with steps, status, and rollup. Tools: `working_memory` (plan, record, mark complete, summarize).
3. **HonchoUserModel** — dialectic user modeling with hypotheses and reconciliation. Persists who you are, what you work on, your tool preferences. Tools: `honcho_observe`, `honcho_reconcile`, `honcho_query`.
4. **HolographicMemory** — HRR (Holographic Reduced Representation) vectors for associative recall. Useful for "what was similar to this" queries without an embedding server.
5. **UserProfile** — structured preferences, aliases, project context.

**Context injection** — Every turn, `buildContext()` selects top memories ranked by `use_count`, estimates token cost, and injects them under `## Memories`. Frequently-used knowledge wins over stale entries.

**Cross-session, cross-platform** — The same `.skeleton/memory.db` is shared between CLI and Telegram gateway. Findings from your terminal are available on mobile, and vice versa.

**FTS5 search** — `/search AES encryption` sanitizes input, splits into words, joins with OR — so both `AES` and `encryption` match.

**Manual control** — `/remember <text>`, `/forget <keyword>`, `/memory`. Curator prunes duplicates, orphans, and expired entries.

---

## Skills & CTF Library

Skills are procedural knowledge the agent can invoke by name. Skeleton ships a full skills subsystem:

- **Registry** — load user skills from `.skeleton/skills/` or the Skills Hub.
- **Hub sync** — pull curated skills from remote sources.
- **Guard** — risk scanning before execution (`low` / `medium` / `high` / `critical`).
- **Curator** — dedupe, orphan cleanup, lifecycle updates.
- **Preprocess** — template substitution, env injection.
- **Usage tracking** — counts, lifecycle states, eviction.

**CTF library** (enabled by default, toggle with `SKELETON_CTF_SKILLS=false`):

| Skill | Purpose |
|---|---|
| `solve-challenge` | Orchestrator that picks the right category workflow |
| `ctf-pwn` | Buffer overflows, ROP, heap, format strings |
| `ctf-web` | LFI / RCE / SSRF / SQLi / template injection |
| `ctf-crypto` | Classical, RSA, AES, ECC, LLL, oracle attacks |
| `ctf-reverse` | Binary reverse engineering pipeline |
| `ctf-forensics` | Disk, memory, network forensics |
| `ctf-misc` | Steganography, esoteric formats |
| `ctf-osint` | Open-source intelligence |
| `ctf-malware` | Malware triage and unpacking |
| `ctf-ai-ml` | Adversarial ML, prompt injection |
| `ctf-js-deobfuscation` | Unminify / deobfuscate JS payloads |
| `ctf-wasm-reverse` | WASM disassembly and static analysis |
| `ctf-api-reverse` | API reverse engineering |
| `ctf-bundle-analysis` | Webpack / Vite bundle inspection |
| `ctf-chrome-extension-audit` | Manifest + content-script audit |
| `ctf-anti-bot-bypass` | Fingerprint evasion and stealth |
| `ctf-writeup` | Post-mortem writeup generator |

---

## Providers

34 pre-configured provider profiles, each with its own baseUrl, env var, default model, API mode, and transport quirks:

**Tier 1 — Major cloud:** `openai`, `anthropic`, `gemini`, `azure-foundry`

**Tier 2 — Chinese providers:** `deepseek`, `alibaba` (qwen), `alibaba-coding` (qwen-coder), `minimax`, `minimax-cn`, `kimi-coding` (kimi/moonshot), `kimi-coding-cn`, `stepfun`, `xiaomi`

**Tier 3 — Routers / aggregators:** `openrouter`, `ai-gateway`

**Tier 4 — Specialized / research:** `arcee`, `huggingface`, `nvidia` (nim), `nous`, `xai` (grok)

**Tier 5 — Local / self-hosted:** `ollama`, `lm-studio`

**Tier 6 — Emerging / niche:** `gmi`, `kilocode`, `opencode-zen`, `opencode-go`, `zai`

**Tier 7 — Serverless inference:** `fireworks`, `together`, `groq`, `cerebras`, `sambanova`

**Tier 8 — API-mode defined / deferred auth:** `openai-codex`, `bedrock`, `deepseek-anthropic`, `copilot`

Add your own with `registerProvider()` — see `packages/core/src/providers/profiles.ts`.

---

## Built-in Tools

11 tools ship out of the box, grouped into toolsets:

| Toolset | Tools |
|---|---|
| **re** | `identify` 🔍 · `hexdump` 📐 · `strings` 📝 · `pe_info` 🪟 · `elf_info` 🐧 · `entropy` 📊 · `disassemble` ⚙️ |
| **web** | `web_search` 🌐 · `web_fetch` 📄 |
| **system** | `terminal` 💻 |
| **browser** | `browser` 🌍 (CDP-based) |

Plus agent-level meta-tools exposed to the LLM: `todo`, `clarify`, `vision`, `image_gen`, `delegate_task`, `kanban`, `memory_*`, `working_memory`, `honcho_*`, `skill_manage`, `cron_manage`, `ptc`, `moa`, `sandbox_terminal`, `tts`, `transcription`, and every MCP tool you enable.

Binaries handled purely in Node with no external deps: `pe-library` for PE, `elf-tools` for ELF. `disassemble` shells out to Capstone-compatible tools if present; otherwise falls back to entropy + string heuristics.

---

## MCP Integration

Built-in MCP host with 50+ curated server definitions. All disabled by default — enable individually in `skeleton.yaml` or with an env flag.

| Category | Example servers |
|---|---|
| **Static analysis** | `ghidra-mcp`, `ghidra-headless-mcp`, `re-mcp-ghidra`, `re-mcp-ida`, `radare2-mcp`, `ida-mcp`, `reversecore-mcp`, `jadx-mcp`, `rbinmcp` |
| **Dynamic analysis** | `x64dbg-mcp`, `frida-mcp`, `nexuscore-mcp`, `kahlo-mcp`, `cheatengine-mcp`, `safiye-monitor` |
| **Malware / threat intel** | `yara-mcp`, `capa-mcp`, `binwalk-mcp`, `virustotal-mcp` |
| **Security audit / pentest** | `nmap-mcp`, `nuclei-mcp`, `sqlmap-mcp`, `ffuf-mcp`, `hashcat-mcp`, `searchsploit-mcp`, `semgrep-mcp`, `bloodhound-mcp`, `burp-mcp`, `masscan-mcp`, `boofuzz-mcp`, `gitleaks-mcp` |
| **Blockchain** | `solazy-mcp`, `medusa-mcp` |
| **Cloud security** | `trivy-mcp`, `prowler-mcp`, `roadrecon-mcp` |
| **Forensics** | `dfireballz-mcp` |
| **OSINT** | `maigret-mcp`, `shodan-mcp`, `otx-mcp` |
| **Browser instrumentation** | `jshook` (387 tools), `playwright-mcp`, `chrome-devtools-mcp`, `firefox-devtools-mcp`, `rc-devtools-mcp`, `cdp-tools-mcp`, `flowlens-mcp` |
| **Web reversing** | `web-reversing-mcp`, `mitmproxy-mcp`, `api-tester-mcp` |

Full list and per-server config in [`skeleton.yaml`](skeleton.yaml). OAuth flow supported via `buildMcpOAuth()`. Malware scanning for npm/pip packages before install via `checkPackageForMalware()`.

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SKELETON_PROTOCOL` | Yes | `openai` or `anthropic` |
| `SKELETON_API_KEY` | Yes | Your API key |
| `SKELETON_BASE_URL` | Yes | Base URL — everything before `/v1` |
| `SKELETON_MODEL` | Yes | Model name |
| `SKELETON_TG_TOKEN` | TG only | Telegram bot token from [@BotFather](https://t.me/BotFather) |
| `SKELETON_TG_ALLOWED_USERS` | TG only | `*` (default) or comma-separated user IDs |
| `SKELETON_TG_GROUP_MODE` | TG only | `off` / `mention` (default) / `all` |
| `SKELETON_TG_REACTIONS` | TG only | `true` (default) / `false` — 👀 / 👍 / 👎 |
| `SKELETON_CTF_SKILLS` | No | `true` (default) / `false` / `auto` |
| `SKELETON_JSHOOK` | No | Auto-enable jshookmcp browser tools |

See [`.env.example`](.env.example) for the full list.

### YAML Config

Create `skeleton.yaml` in your project, or `~/.skeleton/config.yaml` for user-level defaults:

```yaml
llm:
  provider: deepseek
  model: deepseek-chat
  # maxTokens: 4096
  # temperature: 0.3

fallback:
  provider: anthropic
  model: claude-sonnet-4-20250514

agent:
  maxTurns: 90
  systemPrompt: "You are Skeleton, a reverse engineering AI assistant."

compression:
  enabled: true
  threshold: 0.50        # compress when 50% of context used
  targetRatio: 0.20      # compress down to 20% of threshold
  protectLastN: 20       # always keep most recent N messages
  toolOutputThreshold: 2000
  toolOutputHead: 800
  toolOutputTail: 400

tools:
  builtin: true
  # builtinList: ["identify", "hexdump", "strings"]

skills:
  ctf: true              # enable CTF library

mcp:
  servers:
    ghidra-mcp:
      env:
        GHIDRA_MCP_PATH: "/path/to/GhidraMCP"
```

Values support `${VAR}` substitution — see [`config.example.yaml`](config.example.yaml) for a full annotated example with all 34 providers and all 50+ MCP servers.

### Credential Pool

Rotate across multiple keys with `round-robin` / `random` / `failover`:

```yaml
credentials:
  strategy: round-robin
  pool:
    - apiKey: sk-ant-xxx
    - apiKey: sk-ant-yyy
    - apiKey: sk-ant-zzz
```

### Auxiliary Models

Route specific tasks to cheaper/faster models — compression, vision, web extraction, title generation, session search, skills hub, MCP, judge, error classification:

```yaml
auxiliary:
  compression:
    provider: deepseek
    model: deepseek-chat
  vision:
    provider: openai
    model: gpt-4o-mini
```

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript 5.8 | Type safety, single-language full stack |
| Monorepo | pnpm workspaces | Clean boundaries, shared dev deps |
| OpenAI | `openai` SDK | Chat Completions + native streaming |
| Anthropic | `@anthropic-ai/sdk` | Messages API + `messages.stream()` + prompt caching |
| MCP | `@modelcontextprotocol/sdk` | Official MCP client + server |
| Persistence | `better-sqlite3` + WAL | Zero-config, synchronous, fast |
| Search | SQLite FTS5 + unicode61 | Built-in full-text search, CJK-friendly |
| CLI UI | `ink` + React 19 | Real terminal UI, not a readline wrapper |
| Markdown | `marked` + `cli-highlight` | Terminal syntax highlighting |
| Binary | `pe-library`, `elf-tools` | Pure-JS PE / ELF parsing |
| Telegram | `grammy` | Lightweight, type-safe bot framework |
| Checkpoints | git | Project state history via nested repo |
| Optional | `duck-duck-scrape` | DuckDuckGo search fallback |

---

## Project Layout

```
packages/
  core/                      @skeleton/core — agent engine
    src/
      agent.ts               main loop, fallback, tool dispatch, auto-memory
      transports/            chat-completions · anthropic · codex-responses · bedrock-converse
      providers/             34 provider profiles + registry
      memory/                store · working · honcho · holographic · user-profile · plugins
      session/               SQLite DB · FTS5 search · mirror · context vars
      context/               compressor · engine · references
      tools/                 registry · approval · 11 builtin + meta-tools
        builtin/             identify · hexdump · strings · pe-info · elf-info · entropy · disassemble · terminal · web-search · web-fetch · browser
      mcp/                   host · oauth · security · servers.ts (50+ definitions)
      skills/                registry · hub · sync · guard · curator · preprocess · provenance · usage
        ctf/                 solve-challenge + 16 category workflows
      tool-call-parsers/     hermes · mistral · qwen · deepseek-v3/v3.1 · llama · glm · kimi-k2
      sub-agent/             spawn · parallel · delegate tool
      goals/                 Ralph Loop / GoalManager
      cron/                  parser · scheduler · store · tools
      commands/              66+ slash commands · processor · registry
      hooks.ts               7-event hook registry
      plugin-system.ts       plugin manifest + lifecycle
      checkpoint.ts          git-backed state snapshots
      snapshot.ts            named snapshots (create/restore/list/prune)
      sandbox.ts             Daytona · Modal · Singularity · Vercel Sandbox
      moa.ts · ptc.ts        mixture-of-agents · parallel tool calls
      rl.ts · rl-training.ts batch runner · trajectory training
      trajectory-compressor.ts
      api-server.ts          HTTP API for external clients
      acp.ts                 ACP server skeleton
  cli/                       @skeleton/cli — Ink + React 19 TUI
    src/
      bin.ts · chat-ui.tsx · readline-chat.ts · output-adapter.ts
      markdown.ts · theme.ts · setup.ts · doctor.ts
  tg/                        @skeleton/tg — Telegram gateway
    src/bin.ts

.skeleton/                   runtime state
  memory.db · sessions.db    SQLite with WAL
  checkpoints/.git/          git-backed checkpoint history
  logs/                      daily log files
```

---

## Contributing

```bash
git clone https://github.com/your-org/skeleton.git
cd skeleton
pnpm install
npm run cli           # test the REPL
npm run test          # vitest across all packages
npm run build         # tsdown build for all packages
npm run lint          # recursive lint
```

## License

MIT — see [LICENSE](LICENSE).
