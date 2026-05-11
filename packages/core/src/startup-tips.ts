/**
 * 100 startup tips — random rotation at CLI launch.
 * Categories: commands, features, security, skills, plugins, advanced.
 */

const TIPS = [
  // Commands (25)
  "Tip: /steer <text> injects guidance mid-run without interrupting the current turn.",
  "Tip: /compress <focus> compresses context while preserving details about <focus>.",
  "Tip: /branch <name> and /resume <name> let you fork conversations into parallel timelines.",
  "Tip: /snapshot saves full state — memories + messages + goals. /rollback restores.",
  "Tip: /goal <objective> locks the agent onto a target across multiple turns (Ralph Loop).",
  "Tip: /retry re-runs your last input; /undo removes the last turn.",
  "Tip: /usage shows token spend; /insights shows activity analytics.",
  "Tip: /logs tails ~/.skeleton/logs/ — use /logs errors for warnings only.",
  "Tip: /status prints full agent diagnostics: model, hooks, plugins, skills.",
  "Tip: /kanban manages a durable multi-agent task board with heartbeat + retry.",
  "Tip: /mcp lists built-in MCP servers; /reload-mcp reconnects after config changes.",
  "Tip: /tools shows all registered tools; /toolsets manages tool groups.",
  "Tip: /skills lists CTF skills; /<skill-name> invokes one directly.",
  "Tip: /curator deduplicates skills and cleans orphaned files.",
  "Tip: /plugin list/reload manages extension plugins.",
  "Tip: /honcho observes and reconciles user preferences dialectically.",
  "Tip: /profile shows accumulated user model across sessions.",
  "Tip: /memory lists saved findings; /remember <text> saves manually.",
  "Tip: /search <query> finds past conversations across all sessions.",
  "Tip: /sessions lists recent sessions with timestamps.",
  "Tip: /model [provider:model] switches mid-session.",
  "Tip: /personality [name] loads a SOUL.md persona.",
  "Tip: /skin switches among 5 themes: default, midnight, hacker, sakura, ocean.",
  "Tip: /lang changes UI language (9 supported: en zh ja ko de es fr tr uk).",
  "Tip: /debug generates a diagnostic report you can share for troubleshooting.",

  // Features (25)
  "Tip: Skeleton has 5 memory layers — classic, working, honcho, holographic, user-profile.",
  "Tip: CTF Skills cover 16 categories: pwn, web, crypto, reverse, forensics, misc, osint, malware, and more.",
  "Tip: Built-in tools include identify, hexdump, strings, pe_info, elf_info, entropy, disassemble.",
  "Tip: Use @file:path/to/file to inject file content into your prompt.",
  "Tip: Use @url:https://... to pull live web content into context.",
  "Tip: Use @git:HEAD~3 to include recent git diffs automatically.",
  "Tip: Credential pools rotate API keys on 401/429 — configure llm.apiKeys array.",
  "Tip: Fallback providers kick in when primary fails — configure fallback: in skeleton.yaml.",
  "Tip: Auxiliary models route compression/vision/title tasks to cheaper endpoints.",
  "Tip: ContextCompressor auto-triggers at 50% context usage; /compress manually.",
  "Tip: Post-write lint runs after write_file/patch — JSON, YAML, TOML, Python syntax checks.",
  "Tip: Inline diff previews show what changed after every file write.",
  "Tip: 50+ MCP servers pre-wired — ghidra, ida, radare2, frida, jadx, yara, nmap, and more.",
  "Tip: 4 sandbox backends — Docker, SSH, Modal, Vercel Sandbox — for remote execution.",
  "Tip: Goal loop auto-judges completion using an auxiliary model.",
  "Tip: /yolo toggles auto-approval for repeated commands in a session.",
  "Tip: /fast enables priority processing on OpenAI/Anthropic where supported.",
  "Tip: /voice toggles TTS/STT mode — off/tts/stt/on.",
  "Tip: /copy and /paste work with the system clipboard.",
  "Tip: /image attaches an image for multimodal analysis.",
  "Tip: /cron list/add manages scheduled tasks with natural-language prompts.",
  "Tip: /bg starts a command in background with notify_on_complete support.",
  "Tip: /trajectory exports conversation for RL training or analysis.",
  "Tip: /onboarding walks new users through setup.",
  "Tip: /update checks and applies Skeleton updates.",

  // Security (15)
  "Tip: All secrets are auto-redacted in logs and tool output (redact-by-default).",
  "Tip: Cloud metadata endpoints (169.254.169.254) are hard-blocked in all web tools.",
  "Tip: File writes to .ssh/, .aws/, .bashrc, credentials.json are denied by default.",
  "Tip: Cron prompts are scanned for injection before execution.",
  "Tip: TOCTOU-safe atomic writes protect ~/.skeleton/.env, cron store, honcho state.",
  "Tip: MCP packages are scanned against OSV vulnerability database before install.",
  "Tip: Dangerous commands (rm -rf, curl | sh, etc.) require approval.",
  "Tip: SAFE_TOOLS like identify/hexdump/web_search bypass approval — read-only reads.",
  "Tip: Browser navigates are SSRF-checked before loading.",
  "Tip: Tool output is truncated + redacted before entering context (3-tier limits).",
  "Tip: Guardrail detects tool loops — same tool failing 5x triggers halt.",
  "Tip: Hooks can block tool calls: return { blocked: true, reason: '...' } from pre_tool_call.",
  "Tip: Session DB is local-only — ~/.skeleton/sessions.db never leaves your machine.",
  "Tip: Approval callbacks can require user confirmation before destructive ops.",
  "Tip: Private keys in paths (id_rsa, *.pem) are always denied from writes.",

  // Skills & plugins (15)
  "Tip: User-invocable skills automatically become /skill-name slash commands.",
  "Tip: Plugins in ~/.skeleton/plugins/ or node_modules/@skeleton-plugin/ auto-load.",
  "Tip: Plugins can register tools, hooks, commands, providers, and result transformers.",
  "Tip: Plugin's ctx.dispatchTool() calls any registered tool from plugin code.",
  "Tip: transform_llm_output hook lets plugins reshape responses before storage.",
  "Tip: transform_tool_result hook rewrites tool output before it lands in messages.",
  "Tip: SkillHub syncs skills from remote sources — configure with hub URL.",
  "Tip: SkillsGuard scans skills for risky patterns before execution.",
  "Tip: Skills can declare required config.yaml settings (prompted during setup).",
  "Tip: solve-challenge skill orchestrates the right CTF workflow automatically.",
  "Tip: ctf-writeup skill generates standardized post-solve writeups.",
  "Tip: ctf-js-deobfuscation handles minified/obfuscated web payloads.",
  "Tip: ctf-wasm-reverse disassembles WebAssembly modules.",
  "Tip: ctf-anti-bot-bypass handles fingerprint and detection evasion.",
  "Tip: ctf-chrome-extension-audit analyzes manifest + content scripts.",

  // Advanced (20)
  "Tip: 10 tool-call parsers — hermes, mistral, qwen, deepseek-v3/v3.1, llama, glm, kimi-k2, longcat, qwen3-coder.",
  "Tip: 34 pre-configured providers: OpenAI, Anthropic, Gemini, Fireworks, OpenRouter, Groq, and 28 more.",
  "Tip: 4 transport layers: Chat Completions, Anthropic Messages, Codex Responses, Bedrock Converse, Gemini Native.",
  "Tip: Checkpoints v2 uses git shadow repo for file versioning with auto-pruning.",
  "Tip: Snapshots persist full state to ~/.skeleton/snapshots/ — restore anytime.",
  "Tip: Kanban durable mode: heartbeat, zombie detection, reclaim, retry budgets, hallucination gates.",
  "Tip: ACP server exposes Skeleton to Zed, VS Code, JetBrains via /steer and /queue.",
  "Tip: API server exposes /v1/chat/completions for Open WebUI and Cline integration.",
  "Tip: SKELETON_PROXY / HTTPS_PROXY / SOCKS proxy is auto-applied to all HTTP calls.",
  "Tip: Inactivity-based timeout — active tasks never get killed.",
  "Tip: Config validation at startup catches YAML typos before cryptic runtime errors.",
  "Tip: MCP SSE transport supported via mcp.servers.<name>.transport: sse.",
  "Tip: OpenRouter response caching enabled by default via quirks.extraBody.",
  "Tip: RL training: /trajectory → Atropos environments → fine-tune tool-calling models.",
  "Tip: BackgroundTaskManager with notify_on_complete fires when long tasks finish.",
  "Tip: Sub-agents inherit parent config, restricted toolsets, filesystem coordination.",
  "Tip: Delegate tasks with 'parallel' mode for concurrent investigation (max 3 at once).",
  "Tip: Honcho hypotheses can be reconciled (auto-merge contradictions) via /honcho reconcile.",
  "Tip: Auxiliary routing: vision/compression/judge/errorClassifier can each use a different model.",
  "Tip: Credential sources: resolve from ENV, file, or vault — keep secrets out of config.yaml.",
];

/** Get a random tip from the 100-tip pool */
export function getRandomTip(): string {
  return TIPS[Math.floor(Math.random() * TIPS.length)];
}

/** Get N unique random tips */
export function getRandomTips(n: number): string[] {
  const shuffled = [...TIPS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, TIPS.length));
}

/** Get total tip count (for tests / docs) */
export function getTipCount(): number {
  return TIPS.length;
}
