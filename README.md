<p align="center">
  <img src="assets/banner.svg" alt="Skeleton" width="100%">
</p>

<!-- # Skeleton 🔑 -->

<p align="center">
  <a href="https://github.com/your-org/skeleton/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License: MIT"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node-%3E%3D22-339933?style=for-the-badge&logo=node.js&logoColor=white" alt="Node"></a>
  <img src="https://img.shields.io/badge/TypeScript-5.8-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/pnpm-10-F69220?style=for-the-badge&logo=pnpm&logoColor=white" alt="pnpm">
  <img src="https://img.shields.io/badge/Protocol-OpenAI%20%7C%20Anthropic-FFD700?style=for-the-badge" alt="Protocols">
  <a href="README_CN.md"><img src="https://img.shields.io/badge/Lang-中文-red?style=for-the-badge" alt="中文"></a>
</p>

**The self-improving reverse engineering AI agent.** It's the agent with a built-in learning loop — it auto-extracts key findings from every conversation (vulnerabilities, offsets, encryption algorithms, decryption keys), persists them in a SQLite + FTS5 knowledge store across sessions, and injects them back into the system prompt on every turn. The more you use it, the sharper it gets. Talk to it from your terminal or from Telegram — same brain, same memory.

Use any model you want — [Fireworks AI](https://fireworks.ai), [OpenRouter](https://openrouter.ai), [Together AI](https://together.ai), local [vLLM](https://github.com/vllm-project/vllm), [Ollama](https://ollama.ai), or any OpenAI/Anthropic-compatible endpoint. Two protocols, zero confusion — set `SKELETON_PROTOCOL=openai` or `anthropic` and point `SKELETON_BASE_URL` at your provider. Switch in `.env`, no code changes, no lock-in.

**Why "Skeleton"?** Like a skeleton key that opens any lock, this agent is built to unlock any binary. And like skeletal reduction in reverse engineering, it strips away obfuscation layer by layer — until the bones are bare.

<table>
<tr><td width="200"><b>A real terminal interface</b></td><td>Full TUI with box-drawn input frame, streaming token-by-token output, spinner animation, syntax-highlighted markdown via <code>marked</code> + <code>cli-highlight</code>, and a slash-command system. Not a readline wrapper — a proper CLI experience with the golden key ASCII logo rendered at startup.</td></tr>
<tr><td><b>A closed learning loop</b></td><td>Agent-curated memory that auto-extracts RE-specific findings. Deduplication via prefix matching prevents knowledge rot. Top memories ranked by <code>use_count</code> are injected into the system prompt each turn — the agent literally gets smarter every session. FTS5 full-text search with Unicode tokenization for cross-session recall. Manual control with <code>/remember</code>, <code>/forget</code>, and <code>/memory</code>.</td></tr>
<tr><td><b>Lives where you do</b></td><td>Terminal CLI and Telegram gateway — all from a single shared memory store. Find a vulnerability at your desk, ask about it from your phone. The memory is the same. Set <code>SKELETON_TG_TOKEN</code> and you're live on Telegram in one command.</td></tr>
<tr><td><b>Dual protocol, any endpoint</b></td><td>OpenAI Chat Completions and Anthropic Messages — the two protocols that matter. Custom <code>SKELETON_BASE_URL</code> means Fireworks, OpenRouter, Together, vLLM, Ollama, or your own server. Optional fallback provider in <code>skeleton.yaml</code> for resilience.</td></tr>
<tr><td><b>Streaming first</b></td><td>Token-by-token streaming in both interactive REPL and one-shot mode. The agent's thinking unfolds in real time — no staring at a blank screen waiting for a full response. Spinner animation during inference, instant token delivery on first chunk.</td></tr>
<tr><td><b>Full-text session search</b></td><td>Every conversation is indexed in SQLite FTS5 with Unicode61 tokenization. <code>/search exploit</code>, <code>/search AES</code>, <code>/search 0x4A2F</code> — find where you discussed anything, across all sessions, in milliseconds.</td></tr>
</table>

---

## Quick Install

```bash
git clone https://github.com/your-org/skeleton.git
cd skeleton
pnpm install
```

> **Prerequisites:** [Node.js](https://nodejs.org) >= 22 and [pnpm](https://pnpm.io) (or use `npx pnpm`).

Create `.env` in the project root:

```bash
SKELETON_PROTOCOL=anthropic
SKELETON_API_KEY=sk-ant-...
SKELETON_BASE_URL=https://api.anthropic.com
SKELETON_MODEL=claude-sonnet-4-5-20250514
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
> | Local vLLM | openai | `http://localhost:8000` |
> | Ollama | openai | `http://localhost:11434` |

---

## Getting Started

```bash
npm run cli                                                    # Interactive REPL — start a conversation
npx tsx packages/cli/src/bin.ts "analyze this: mov eax, [ebp+8]"  # One-shot streaming query
npm run tg                                                     # Start Telegram gateway
```

## CLI vs Telegram Quick Reference

Skeleton has two entry points: the terminal UI via `npm run cli`, or the Telegram gateway via `npm run tg`. Once you're in a conversation, slash commands are shared across both.

| Action | CLI | Telegram |
|--------|-----|----------|
| Start chatting | `npm run cli` | Set `SKELETON_TG_TOKEN`, run `npm run tg`, message the bot |
| Start fresh conversation | `/new` | `/new` |
| Reset conversation | `/reset` | `/reset` |
| View conversation history | `/history` | `/history` |
| View saved memories | `/memory` | `/memory` |
| Save a memory manually | `/remember <text>` | `/remember <text>` |
| Delete memories by keyword | `/forget <keyword>` | `/forget <keyword>` |
| Search past sessions | `/search <query>` | `/search <query>` |
| Show model & session info | `/model` | `/model` |
| Exit | `/quit` or `/exit` | — |

---

## Architecture

```
  ┌─────────┐    ┌─────────┐
  │   CLI   │    │   TG    │
  └────┬────┘    └────┬────┘
       │              │
       └──────┬───────┘
              │
        ┌─────▼─────┐
        │   Agent   │  ← fallback routing, tool loops, auto-memory
        └─────┬─────┘
              │
       ┌──────┴──────┐
       │             │
 ┌─────▼─────┐ ┌────▼─────┐
 │  Memory   │ │ Session  │
 │  Store    │ │   DB     │
 │ (SQLite   │ │ (SQLite  │
 │  + FTS5)  │ │  + WAL)  │
 └───────────┘ └──────────┘

       │ Transport Layer │
  ┌────┴─────────────────┴────┐
  │                           │
  ▼                           ▼
OpenAI                  Anthropic
Chat Completions        Messages API
```

| Package | What it does |
|---|---|
| `@skeleton/core` | Agent engine — transport abstraction (OpenAI + Anthropic), memory store (SQLite + FTS5), session DB (SQLite + WAL), tool registry, config loader |
| `@skeleton/cli` | Terminal TUI — REPL with box-drawn input, streaming output, spinner, syntax-highlighted markdown, golden key logo |
| `@skeleton/tg` | Telegram gateway — grammy bot, shared memory store with CLI |

---

## Memory System

Skeleton's memory is a **closed learning loop** — not a simple chat log, but an accumulating knowledge base that makes the agent smarter every session:

1. **Auto-extraction** — The agent scans every response for RE-specific keywords (`vulnerability`, `exploit`, `offset`, `address`, `function`, `algorithm`, `key`, `decrypt`, `encrypt`, `hash`, `struct`, `protocol`, `format`, `header`, and their Chinese equivalents `漏洞`, `偏移`, `地址`, `函数`, `算法`, `密钥`, `加密`). Lines containing these terms are saved automatically.
2. **Deduplication** — Before inserting, `MemoryStore.exists()` checks if content with a matching 40-character prefix already exists. No duplicates pile up, no knowledge rot.
3. **Context injection** — On every turn, `buildContext()` selects top memories ranked by `use_count`, estimates token cost, and injects them into the system prompt under a `## Memories` header. Frequently-used knowledge is prioritized over stale entries.
4. **Cross-session + cross-platform** — Memory persists in `.skeleton/memory.db` across CLI restarts and is shared with the Telegram gateway. Findings from your terminal are available on mobile, and vice versa.
5. **FTS5 search** — `memories_fts` uses `unicode61` tokenization. `/search` sanitizes special characters, splits into words, joins with OR — so `/search AES encryption` finds any memory containing "AES" or "encryption".
6. **Manual control** — `/remember <text>` to force-save with `source=manual`, `/forget <keyword>` to prune by LIKE match, `/memory` to inspect all entries.

---

## Configuration

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SKELETON_PROTOCOL` | Yes | `openai` or `anthropic` |
| `SKELETON_API_KEY` | Yes | Your API key |
| `SKELETON_BASE_URL` | Yes | Base URL — everything before `/v1` |
| `SKELETON_MODEL` | Yes | Model name (e.g. `gpt-4o`, `claude-sonnet-4-5-20250514`, or any custom model) |
| `SKELETON_TG_TOKEN` | TG only | Telegram bot token from [@BotFather](https://t.me/BotFather) |
| `SKELETON_TG_ALLOWED_USERS` | TG only | Who can chat with the bot: `*` = everyone (default), or comma-separated user IDs (e.g. `123456,789012`) for whitelist |
| `SKELETON_TG_GROUP_MODE` | TG only | Bot behavior in groups: `off` = ignore groups, `mention` = only reply when @mentioned (default), `all` = reply to all messages |
| `SKELETON_TG_REACTIONS` | TG only | Message reactions (👀 processing / 👍 success / 👎 failure): `true` = enabled (default), `false` = disabled |

### YAML Config

Create `skeleton.yaml` as an alternative to `.env`:

```yaml
protocol: anthropic
apiKey: sk-ant-...
baseUrl: https://api.anthropic.com
model: claude-sonnet-4-5-20250514
```

### Fallback Provider

Set a second provider — if the primary fails, Skeleton falls back automatically:

```yaml
protocol: anthropic
apiKey: sk-ant-...
baseUrl: https://api.anthropic.com
model: claude-sonnet-4-5-20250514
fallback:
  protocol: openai
  apiKey: sk-...
  baseUrl: https://api.openai.com
  model: gpt-4o
```

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript 5.8 | Type safety, ecosystem, single-language full stack |
| Monorepo | pnpm workspaces | Clean package boundaries, shared dev deps |
| LLM — OpenAI | `openai` SDK | Chat Completions API + native streaming |
| LLM — Anthropic | `@anthropic-ai/sdk` | Messages API + `messages.stream()` |
| Persistence | `better-sqlite3` + WAL | Zero-config, synchronous, fast, reliable |
| Search | SQLite FTS5 + unicode61 | Built-in full-text search, no external deps |
| CLI rendering | readline + chalk + ANSI | No Ink/React — direct terminal control |
| Markdown | `marked` + `cli-highlight` | Syntax-highlighted code blocks in terminal |
| Telegram | `grammy` | Lightweight, type-safe bot framework |

---

## Contributing

```bash
git clone https://github.com/your-org/skeleton.git
cd skeleton
pnpm install
npm run cli     # test the REPL
npm run test    # run test suite
npm run build   # build all packages
```

---

## License

MIT — see [LICENSE](LICENSE).
