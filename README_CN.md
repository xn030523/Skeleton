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
  <a href="README.md"><img src="https://img.shields.io/badge/Lang-English-FFD700?style=for-the-badge" alt="English"></a>
</p>

**自我改进的逆向工程 AI 代理。** Skeleton 是一个完整的 TypeScript 代理框架：内置学习闭环——跨会话自动策展记忆、子代理派发、cron 定时、50+ 预接入安全工具的 MCP 宿主、CTF 技能库、以及一个持久化关键发现（漏洞、偏移、算法、密钥）的闭环——存入 SQLite + FTS5 知识库，每轮注入回系统提示。终端或 Telegram 聊天——同一个大脑，同一份记忆。

**34 个预配置 provider**，覆盖 [OpenAI](https://openai.com)、[Anthropic](https://anthropic.com)、[Gemini](https://ai.google.dev)、[Azure](https://azure.microsoft.com)、[Bedrock](https://aws.amazon.com/bedrock)、[Fireworks](https://fireworks.ai)、[OpenRouter](https://openrouter.ai)、[Together](https://together.ai)、[Groq](https://groq.com)、[Cerebras](https://cerebras.ai)、[DeepSeek](https://deepseek.com)、[Qwen](https://qwen.ai)、[Kimi](https://kimi.com)、[MiniMax](https://minimax.io)、[Xiaomi](https://platform.xiaomimimo.com)、[xAI](https://x.ai)、[NVIDIA NIM](https://build.nvidia.com)、[Hugging Face](https://huggingface.co)、[Nous](https://nousresearch.com)、[GitHub Copilot](https://github.com/features/copilot)、本地 [vLLM](https://github.com/vllm-project/vllm) / [Ollama](https://ollama.ai) / [LM Studio](https://lmstudio.ai)、以及任何 OpenAI/Anthropic 兼容端点。四种传输协议（Chat Completions、Anthropic Messages、Codex Responses、Bedrock Converse）共享同一个代理主循环——改一个配置键即可切换，零代码改动。

**为什么叫 "Skeleton"？** 万能钥匙（skeleton key）能开任何锁。就像逆向中的骨架还原（skeletal reduction），层层剥开混淆——直到骨头裸露。

<table>
<tr><td width="180"><b>闭环学习</b></td><td>五层记忆：经典 MemoryStore（FTS5）、WorkingMemory（任务级）、HonchoUserModel（辩证式用户建模，带假设/对账）、HolographicMemory（HRR 向量）、UserProfile。每轮扫描响应提取逆向关键发现，前缀去重，按 <code>use_count</code> 排序，每轮注入回系统提示。可选 Mem0 插件桥接。</td></tr>
<tr><td><b>真正的终端界面</b></td><td>Ink + React 19 TUI：流式 token 输出、旋转动画、语法高亮 Markdown（marked + cli-highlight）、5 款皮肤主题、3 档状态栏密度、9 种界面语言、readline 回退。66+ 斜杠命令、自动补全、历史、中断/重定向。</td></tr>
<tr><td><b>你在哪它就在哪</b></td><td>CLI 和 Telegram 网关共享同一份记忆、同一个会话、同一套技能。一个 SQLite 文件同时服务两端。设 <code>SKELETON_TG_TOKEN</code>，一条命令上线。Grammy 机器人支持白名单、群组模式（off/mention/all）、表情反馈。</td></tr>
<tr><td><b>Skills 和 CTF 知识库</b></td><td>技能注册表：hub 同步、生命周期跟踪、curator（去重/孤立清理）、guard（风险扫描）、溯源、使用计数。内置 CTF 库：<code>solve-challenge</code> 编排器 + 16 个分类工作流（pwn、web、crypto、reverse、forensics、misc、osint、malware、ai-ml、js-deobfuscation、wasm-reverse、api-reverse、bundle-analysis、chrome-extension-audit、anti-bot-bypass、writeup）。</td></tr>
<tr><td><b>派发和并行</b></td><td>子代理派发（串行 + 并行）。Goals / Ralph Loop 长任务循环。Mixture-of-Agents（MoA）和 parallel tool calls（PTC）。辅助模型路由把任务分到专用端点（compression / vision / web-extract / title / session-search / skills-hub / MCP / judge / error-classifier）。</td></tr>
<tr><td><b>MCP 宿主，50+ 预接入工具</b></td><td>内置 MCP 宿主，支持 OAuth。50+ 精选服务器定义覆盖 Ghidra、IDA Pro、radare2、Frida、JADX、x64dbg、Cheat Engine、YARA、capa、binwalk、VirusTotal、nmap、nuclei、sqlmap、ffuf、hashcat、BloodHound、Burp、Semgrep、Trivy、Prowler、Playwright、Chrome DevTools、Firefox DevTools、Maigret、Shodan、jshookmcp（387 浏览器工具）等。config.json 或环境变量一开即用。</td></tr>
<tr><td><b>自动化</b></td><td>Cron 调度器（自带 parser / store / 投递工具）。后台任务管理器（spawn / list / kill / get）。7 事件钩子注册表（pre/post tool、pre/post LLM、session start/stop、on error）。插件系统有生命周期和上下文注入。</td></tr>
<tr><td><b>跑在任何地方</b></td><td>4 个沙箱后端：Daytona、Modal、Singularity、Vercel Sandbox。远程执行命令、读写文件、会话间休眠。Checkpoint 管理器（<code>.skeleton/checkpoints/</code> 内嵌 git 仓库）+ snapshot 管理器（create/restore/list/prune）。</td></tr>
<tr><td><b>研究就绪</b></td><td>轨迹压缩器、批量运行器、带奖励配置的 RL 训练器、8 个模型专属工具调用解析器（Hermes、Mistral、Qwen、DeepSeek V3/V3.1、LLaMA、GLM、Kimi K2），用于微调工具使用模型。</td></tr>
</table>

---

## 快速安装

```bash
git clone https://github.com/your-org/skeleton.git
cd skeleton
pnpm install
```

> **前置条件：** [Node.js](https://nodejs.org) >= 22，[pnpm](https://pnpm.io) 10+（或 `npx pnpm`）。

创建 `~/.skeleton/config.json`：

```json
{
  "baseUrl": "https://api.anthropic.com",
  "apiKey": "sk-ant-...",
  "model": "claude-sonnet-4-5-20250514",
  "provider": "anthropic"
}
```

或用环境变量覆盖：

```bash
SKELETON_PROVIDER=deepseek
SKELETON_MODEL=deepseek-chat
```

开始聊天：

```bash
npm run cli
```

> **Base URL 规则：** URL 设置到 `/v1` **之前**，SDK 自动拼接。
>
> | 服务商 | 协议 | Base URL |
> |---|---|---|
> | OpenAI | openai | `https://api.openai.com` |
> | Anthropic | anthropic | `https://api.anthropic.com` |
> | Fireworks AI | anthropic | `https://api.fireworks.ai/inference` |
> | OpenRouter | openai | `https://openrouter.ai/api` |
> | Together AI | openai | `https://api.together.xyz` |
> | Groq | openai | `https://api.groq.com/openai` |
> | DeepSeek | openai | `https://api.deepseek.com` |
> | 本地 vLLM | openai | `http://localhost:8000` |
> | Ollama | openai | `http://localhost:11434` |
> | LM Studio | openai | `http://localhost:1234` |

---

## 快速开始

```bash
npm run cli                                                    # 交互式 REPL
npx tsx packages/cli/src/bin.ts "分析这段: mov eax, [ebp+8]"    # 一次性流式查询
npm run tg                                                     # 启动 Telegram 网关
npm run build                                                  # 构建所有包
```

## CLI vs Telegram 快速参考

Skeleton 两个入口：`npm run cli` 的终端 UI 和 `npm run tg` 的 Telegram 网关。进入对话后，66+ 斜杠命令两端通用。

| 操作 | CLI | Telegram |
|------|-----|----------|
| 开始聊天 | `npm run cli` | 设置 `SKELETON_TG_TOKEN`，运行 `npm run tg`，给机器人发消息 |
| 新建会话 | `/new` | `/new` |
| 重置对话 | `/reset` | `/reset` |
| 切换模型 | `/model [provider:model]` | `/model` |
| 设置人格 | `/personality [name]` | `/personality` |
| 重试 / 撤销 | `/retry`、`/undo` | `/retry`、`/undo` |
| 分支对话 | `/branch`、`/resume` | `/branch` |
| 检查点 / 快照 | `/snapshot`、`/rollback` | `/snapshot` |
| 压缩 / 用量 / 洞察 | `/compress`、`/usage`、`/insights` | 同上 |
| 查看 / 保存 / 删除记忆 | `/memory`、`/remember`、`/forget` | 同上 |
| 搜索会话 | `/search <query>`、`/sessions` | `/search` |
| 技能 / 工具 / 工具集 | `/skills`、`/tools`、`/toolsets` | 同上 |
| MCP 服务器 | `/mcp`、`/reload-mcp` | `/mcp` |
| 长任务循环 | `/goal`、`/agents`、`/queue` | `/goal` |
| 子代理派发 | `/agents` | `/agents` |
| Cron 定时 | `/cron` | `/cron` |
| 后台任务 | `/bg`、`/stop` | `/bg` |
| Honcho 用户模型 | `/honcho`、`/profile` | `/honcho` |
| 轨迹导出 | `/trajectory` | `/trajectory` |
| UI — 皮肤 / 状态栏 / footer / indicator | `/skin`、`/statusbar`、`/footer`、`/indicator` | — |
| 语言（9 种） | `/lang` | `/lang` |
| 语音 | `/voice` | — |
| 剪贴板 | `/copy`、`/paste` | — |
| 诊断 / 调试报告 / 更新 | `/doctor`（CLI 二进制）、`/debug`、`/update` | `/debug` |
| 中断 | `Ctrl+C` 或发新消息 | `/stop` 或发新消息 |
| 帮助 / 退出 | `/help`、`/quit` | `/help` |

---

## 架构

```
 ┌─────────────────┐        ┌──────────────────┐
 │  @skeleton/cli  │        │  @skeleton/tg    │
 │  (Ink + React)  │        │  (Grammy bot)    │
 └────────┬────────┘        └────────┬─────────┘
          │                          │
          └──────────────┬───────────┘
                         │
                ┌────────▼────────┐
                │   代理主循环    │  goals · sub-agents · hooks · plugins
                │  (fallback /    │  MoA · PTC · auxiliary-router · cron
                │   tool / turn)  │
                └────────┬────────┘
                         │
    ┌────────────────────┼────────────────────┬────────────────┐
    │                    │                    │                │
┌───▼────────┐  ┌────────▼────────┐  ┌────────▼────────┐  ┌───▼────────┐
│  记忆      │  │  会话数据库     │  │  工具注册表     │  │ MCP 宿主   │
│  5 层      │  │  SQLite + WAL   │  │  11 内置 +      │  │  50+ 预    │
│  FTS5 +    │  │  + FTS5 搜索    │  │  沙箱工具       │  │  接入      │
│  HRR + Mem0│  │  + 检查点       │  │  + 工具集       │  │  服务器    │
└────────────┘  └─────────────────┘  └─────────────────┘  └────────────┘
                         │
              ┌──────────▼──────────┐
              │      传输层         │
              └──────────┬──────────┘
                         │
        ┌───────────┬────┴────┬─────────────┐
        ▼           ▼         ▼             ▼
    OpenAI    Anthropic   Codex          Bedrock
    Chat      Messages    Responses      Converse
    Completions (+缓存)   API            API
```

| 包 | 功能 |
|---|---|
| `@skeleton/core` | 代理引擎——4 种传输、34 个 provider、5 层记忆、会话 DB、工具注册表、MCP 宿主、skills/CTF 库、goals、sub-agents、hooks、plugins、cron、4 个沙箱后端、8 个工具调用解析器、配置加载、上下文压缩、辅助路由 |
| `@skeleton/cli` | 终端 TUI——Ink + React 19 聊天 UI，流式、marked + cli-highlight 渲染、5 款皮肤、3 档状态栏、readline 回退、doctor / setup 命令 |
| `@skeleton/tg` | Telegram 网关——Grammy 机器人，与 CLI 共享记忆和会话，群组模式、白名单、表情反馈，MDv2 渲染（含表格转换和 think 块过滤） |

---

## 记忆系统

Skeleton 的记忆是**闭环学习系统**——不是聊天日志，是五层持久知识，让代理每会话都更锋利：

1. **MemoryStore**（`.skeleton/memory.db`）——SQLite + FTS5，unicode61 分词。每轮扫描响应提取逆向关键词（`vulnerability`、`exploit`、`offset`、`address`、`function`、`algorithm`、`key`、`decrypt`、`encrypt`、`hash`、`struct`、`protocol`、`format`、`header`，及中文 `漏洞`、`偏移`、`地址`、`函数`、`算法`、`密钥`、`加密`）。40 字符前缀去重防腐烂。
2. **WorkingMemory**——任务级草稿本，含步骤、状态、汇总。工具：`working_memory`（plan/record/complete/summarize）。
3. **HonchoUserModel**——辩证式用户建模：假设与对账。持久化你是谁、在搞什么、工具偏好。工具：`honcho_observe`、`honcho_reconcile`、`honcho_query`。
4. **HolographicMemory**——HRR（全息归约表示）向量，做联想检索。"与此类似的内容"无需向量服务器。
5. **UserProfile**——结构化偏好、别名、项目上下文。

**上下文注入**——每轮 `buildContext()` 按 `use_count` 选取 top 记忆，估算 token，在 `## Memories` 下注入。高频知识优先于过期条目。

**跨会话 / 跨平台**——同一个 `.skeleton/memory.db` 在 CLI 和 Telegram 网关间共享。终端的发现在手机上可用，反之亦然。

**FTS5 搜索**——`/search AES 加密` 清理特殊字符、拆词、OR 连接——`AES` 和 `加密` 任一命中即匹配。

**手动控制**——`/remember <文本>`、`/forget <关键词>`、`/memory`。Curator 自动清重复、孤立、过期。

---

## Skills 和 CTF 知识库

Skills 是代理可按名调用的程序性知识。Skeleton 自带完整技能系统：

- **Registry**——从 `.skeleton/skills/` 或 Skills Hub 加载用户技能
- **Hub sync**——从远端源拉取精选技能
- **Guard**——执行前风险扫描（`low` / `medium` / `high` / `critical`）
- **Curator**——去重、孤立清理、生命周期更新
- **Preprocess**——模板替换、环境注入
- **Usage tracking**——计数、生命周期状态、淘汰

**CTF 知识库**（默认开启，`SKELETON_CTF_SKILLS=false` 关闭）：

| 技能 | 用途 |
|---|---|
| `solve-challenge` | 编排器，自动选择分类工作流 |
| `ctf-pwn` | 缓冲区溢出、ROP、heap、格式化字符串 |
| `ctf-web` | LFI / RCE / SSRF / SQLi / 模板注入 |
| `ctf-crypto` | 古典、RSA、AES、ECC、LLL、oracle 攻击 |
| `ctf-reverse` | 二进制逆向流水线 |
| `ctf-forensics` | 磁盘、内存、网络取证 |
| `ctf-misc` | 隐写、奇葩格式 |
| `ctf-osint` | 开源情报 |
| `ctf-malware` | 恶意软件分类和脱壳 |
| `ctf-ai-ml` | 对抗性 ML、提示注入 |
| `ctf-js-deobfuscation` | JS 去混淆 / 反压缩 |
| `ctf-wasm-reverse` | WASM 反汇编和静态分析 |
| `ctf-api-reverse` | API 逆向 |
| `ctf-bundle-analysis` | Webpack / Vite 包检查 |
| `ctf-chrome-extension-audit` | Manifest + 内容脚本审计 |
| `ctf-anti-bot-bypass` | 指纹规避和隐身 |
| `ctf-writeup` | 复盘 writeup 生成 |

---

## Provider

34 个预配置 provider，每个都带自己的 baseUrl、环境变量、默认模型、API 模式、传输 quirk：

**一级 — 主流云厂商：** `openai`、`anthropic`、`gemini`、`azure-foundry`

**二级 — 中国 provider：** `deepseek`、`alibaba`（qwen）、`alibaba-coding`（qwen-coder）、`minimax`、`minimax-cn`、`kimi-coding`（kimi/moonshot）、`kimi-coding-cn`、`stepfun`、`xiaomi`

**三级 — 路由 / 聚合：** `openrouter`、`ai-gateway`

**四级 — 专业 / 研究：** `arcee`、`huggingface`、`nvidia`（nim）、`nous`、`xai`（grok）

**五级 — 本地 / 自部署：** `ollama`、`lm-studio`

**六级 — 新兴 / 小众：** `gmi`、`kilocode`、`opencode-zen`、`opencode-go`、`zai`

**七级 — 无服务器推理：** `fireworks`、`together`、`groq`、`cerebras`、`sambanova`

**八级 — API 模式已定义 / 认证延期：** `openai-codex`、`bedrock`、`deepseek-anthropic`、`copilot`

用 `registerProvider()` 自己注册，见 `packages/core/src/providers/profiles.ts`。

---

## 内置工具

开箱 11 个工具，按工具集分组：

| 工具集 | 工具 |
|---|---|
| **re** | `identify` 🔍 · `hexdump` 📐 · `strings` 📝 · `pe_info` 🪟 · `elf_info` 🐧 · `entropy` 📊 · `disassemble` ⚙️ |
| **web** | `web_search` 🌐 · `web_fetch` 📄 |
| **system** | `terminal` 💻 |
| **browser** | `browser` 🌍（基于 CDP） |

再加暴露给 LLM 的代理级元工具：`todo`、`clarify`、`vision`、`image_gen`、`delegate_task`、`kanban`、`memory_*`、`working_memory`、`honcho_*`、`skill_manage`、`cron_manage`、`ptc`、`moa`、`sandbox_terminal`、`tts`、`transcription`，以及所有启用的 MCP 工具。

二进制处理纯 Node、无外部依赖：PE 用 `pe-library`、ELF 用 `elf-tools`。`disassemble` 如有 Capstone 兼容工具则 shell 出去，否则退化到熵 + 字符串启发。

---

## MCP 集成

内置 MCP 宿主，50+ 精选服务器定义。默认全关，在 `config.json` 或环境变量里单独开。

| 分类 | 示例服务器 |
|---|---|
| **静态分析** | `ghidra-mcp`、`ghidra-headless-mcp`、`re-mcp-ghidra`、`re-mcp-ida`、`radare2-mcp`、`ida-mcp`、`reversecore-mcp`、`jadx-mcp`、`rbinmcp` |
| **动态分析** | `x64dbg-mcp`、`frida-mcp`、`nexuscore-mcp`、`kahlo-mcp`、`cheatengine-mcp`、`safiye-monitor` |
| **恶意软件 / 威胁情报** | `yara-mcp`、`capa-mcp`、`binwalk-mcp`、`virustotal-mcp` |
| **安全审计 / 渗透** | `nmap-mcp`、`nuclei-mcp`、`sqlmap-mcp`、`ffuf-mcp`、`hashcat-mcp`、`searchsploit-mcp`、`semgrep-mcp`、`bloodhound-mcp`、`burp-mcp`、`masscan-mcp`、`boofuzz-mcp`、`gitleaks-mcp` |
| **区块链** | `solazy-mcp`、`medusa-mcp` |
| **云安全** | `trivy-mcp`、`prowler-mcp`、`roadrecon-mcp` |
| **数字取证** | `dfireballz-mcp` |
| **OSINT** | `maigret-mcp`、`shodan-mcp`、`otx-mcp` |
| **浏览器** | `jshook`（387 工具）、`playwright-mcp`、`chrome-devtools-mcp`、`firefox-devtools-mcp`、`rc-devtools-mcp`、`cdp-tools-mcp`、`flowlens-mcp` |
| **Web 逆向** | `web-reversing-mcp`、`mitmproxy-mcp`、`api-tester-mcp` |

完整清单和每个服务器的配置见 [`config.example.json`](config.example.json)。OAuth 支持通过 `buildMcpOAuth()`。安装前 npm/pip 包恶意扫描用 `checkPackageForMalware()`。

---

## 配置

### JSON 配置

创建 `~/.skeleton/config.json`（或运行 `skeleton setup`）：

```json
{
  "baseUrl": "https://api.deepseek.com",
  "apiKey": "sk-...",
  "model": "deepseek-chat",
  "provider": "deepseek",
  "fallback": {
    "provider": "anthropic",
    "baseUrl": "https://api.anthropic.com",
    "apiKey": "sk-ant-...",
    "model": "claude-sonnet-4-20250514"
  },
  "mcp": {
    "ghidra-mcp": {
      "env": { "GHIDRA_MCP_PATH": "/path/to/GhidraMCP" }
    }
  }
}
```

完整示例见 [`config.example.json`](config.example.json)。

### 环境变量（覆盖）

| 变量 | 必填 | 说明 |
|---|---|---|
| `SKELETON_PROVIDER` | 否 | Provider 名（覆盖 config.json） |
| `SKELETON_MODEL` | 否 | 模型名（覆盖 config.json） |
| `SKELETON_API_KEY` | 否 | API 密钥（覆盖 config.json） |
| `SKELETON_BASE_URL` | 否 | 基础 URL（覆盖 config.json） |
| `SKELETON_TG_TOKEN` | TG | [@BotFather](https://t.me/BotFather) 的 bot token |
| `SKELETON_TG_ALLOWED_USERS` | TG | `*`（默认）或逗号分隔 user ID |
| `SKELETON_TG_GROUP_MODE` | TG | `off` / `mention`（默认）/ `all` |
| `SKELETON_TG_REACTIONS` | TG | `true`（默认）/ `false`——👀 / 👍 / 👎 |
| `SKELETON_CTF_SKILLS` | 否 | `true`（默认）/ `false` / `auto` |
| `SKELETON_JSHOOK` | 否 | 自动启用 jshookmcp 浏览器工具 |

### 凭证池

`round-robin` / `random` / `failover` 策略轮换多个 key：

```json
{
  "apiKeys": ["sk-ant-xxx", "sk-ant-yyy", "sk-ant-zzz"],
  "credentialStrategy": "round_robin"
}
```

### 辅助模型

把特定任务路由到更便宜 / 更快的模型——压缩、视觉、网页抽取、标题生成、会话搜索、skills hub、MCP、judge、错误分类：

```json
{
  "auxiliary": {
    "compression": { "provider": "deepseek", "model": "deepseek-chat" },
    "vision": { "provider": "openai", "model": "gpt-4o-mini" }
  }
}
```

---

## 技术栈

| 层 | 选型 | 原因 |
|---|---|---|
| 语言 | TypeScript 5.8 | 类型安全，全栈单语言 |
| 单仓 | pnpm workspaces | 清晰包边界，共享开发依赖 |
| OpenAI | `openai` SDK | Chat Completions + 原生流式 |
| Anthropic | `@anthropic-ai/sdk` | Messages API + `messages.stream()` + prompt caching |
| MCP | `@modelcontextprotocol/sdk` | 官方 MCP client + server |
| 持久化 | `better-sqlite3` + WAL | 零配置、同步、快速 |
| 搜索 | SQLite FTS5 + unicode61 | 内置全文搜索，CJK 友好 |
| CLI UI | `ink` + React 19 | 真正的终端 UI |
| Markdown | `marked` + `cli-highlight` | 终端语法高亮 |
| 二进制 | `pe-library`、`elf-tools` | 纯 JS PE / ELF 解析 |
| Telegram | `grammy` | 轻量、类型安全 |
| 检查点 | git | 嵌套 git 仓库做项目状态历史 |
| 可选 | `duck-duck-scrape` | DuckDuckGo 搜索回退 |

---

## 项目结构

```
packages/
  core/                      @skeleton/core — 代理引擎
    src/
      agent.ts               主循环、fallback、工具派发、自动记忆
      transports/            chat-completions · anthropic · codex-responses · bedrock-converse
      providers/             34 个 provider profile + 注册表
      memory/                store · working · honcho · holographic · user-profile · plugins
      session/               SQLite DB · FTS5 搜索 · mirror · context vars
      context/               compressor · engine · references
      tools/                 registry · approval · 11 内置 + 元工具
        builtin/             identify · hexdump · strings · pe-info · elf-info · entropy · disassemble · terminal · web-search · web-fetch · browser
      mcp/                   host · oauth · security · servers.ts（50+ 定义）
      skills/                registry · hub · sync · guard · curator · preprocess · provenance · usage
        ctf/                 solve-challenge + 16 个分类工作流
      tool-call-parsers/     hermes · mistral · qwen · deepseek-v3/v3.1 · llama · glm · kimi-k2
      sub-agent/             spawn · parallel · delegate 工具
      goals/                 Ralph Loop / GoalManager
      cron/                  parser · scheduler · store · tools
      commands/              66+ 斜杠命令 · processor · registry
      hooks.ts               7 事件钩子注册表
      plugin-system.ts       插件 manifest + 生命周期
      checkpoint.ts          git-backed 状态快照
      snapshot.ts            命名快照（create/restore/list/prune）
      sandbox.ts             Daytona · Modal · Singularity · Vercel Sandbox
      moa.ts · ptc.ts        mixture-of-agents · parallel tool calls
      rl.ts · rl-training.ts 批量运行器 · 轨迹训练
      trajectory-compressor.ts
      api-server.ts          对外 HTTP API
      acp.ts                 ACP server 骨架
  cli/                       @skeleton/cli — Ink + React 19 TUI
    src/
      bin.ts · chat-ui.tsx · readline-chat.ts · output-adapter.ts
      markdown.ts · theme.ts · setup.ts · doctor.ts
  tg/                        @skeleton/tg — Telegram 网关
    src/bin.ts

.skeleton/                   运行时状态
  memory.db · sessions.db    SQLite + WAL
  checkpoints/.git/          git-backed 检查点历史
  logs/                      按日日志文件
```

---

## 参与贡献

```bash
git clone https://github.com/your-org/skeleton.git
cd skeleton
pnpm install
npm run cli           # 测试 REPL
npm run test          # 所有包跑 vitest
npm run build         # 所有包跑 tsdown 构建
npm run lint          # 递归 lint
```

## 许可证

MIT — 详见 [LICENSE](LICENSE)。
