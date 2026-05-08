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
  <a href="README.md"><img src="https://img.shields.io/badge/Lang-English-FFD700?style=for-the-badge" alt="English"></a>
</p>

**自我改进的逆向工程 AI 代理。** 内置闭环学习——从每次对话中自动提取关键发现（漏洞、偏移、加密算法、解密密钥），持久化到 SQLite + FTS5 知识库，每轮注入回系统提示。用得越多，它越锋利。终端或 Telegram 都能聊——同一个大脑，同一份记忆。

用任何你想用的模型——[Fireworks AI](https://fireworks.ai)、[OpenRouter](https://openrouter.ai)、[Together AI](https://together.ai)、本地 [vLLM](https://github.com/vllm-project/vllm)、[Ollama](https://ollama.ai)、或任何 OpenAI/Anthropic 兼容端点。两个协议，零困惑——设 `SKELETON_PROTOCOL=openai` 或 `anthropic`，把 `SKELETON_BASE_URL` 指向你的 provider。改 `.env` 即可切换，无需改代码，无锁定。

**为什么叫 "Skeleton"？** 万能钥匙（skeleton key）能开任何锁，这个代理专为解锁任何二进制而生。就像逆向中的骨架还原（skeletal reduction），层层剥开混淆——直到骨头裸露。

<table>
<tr><td width="200"><b>真正的终端界面</b></td><td>完整的 TUI：方框输入框、逐 token 流式输出、旋转等待动画、<code>marked</code> + <code>cli-highlight</code> 语法高亮 Markdown、斜杠命令系统。启动时渲染金色钥匙 ASCII logo。不是 readline 包装——是真正的 CLI 体验。</td></tr>
<tr><td><b>闭环学习</b></td><td>代理自动提取逆向关键发现。前缀匹配去重防止知识腐烂。按 <code>use_count</code> 排名的 top 记忆每轮注入系统提示——代理真的每会话都变聪明。FTS5 + Unicode 分词全文搜索实现跨会话召回。手动控制：<code>/remember</code>、<code>/forget</code>、<code>/memory</code>。</td></tr>
<tr><td><b>你在哪它就在哪</b></td><td>终端 CLI 和 Telegram 网关——共享同一个记忆库。在桌上发现漏洞，在手机上追问。记忆是同一份。设 <code>SKELETON_TG_TOKEN</code>，一条命令上线 Telegram。</td></tr>
<tr><td><b>双协议，任意端点</b></td><td>OpenAI Chat Completions 和 Anthropic Messages——两个真正重要的协议。自定义 <code>SKELETON_BASE_URL</code> 意味着 Fireworks、OpenRouter、Together、vLLM、Ollama 或你自己的服务器都能用。<code>skeleton.yaml</code> 可选备用 provider 提高可靠性。</td></tr>
<tr><td><b>流式优先</b></td><td>交互式 REPL 和 one-shot 模式都逐 token 流式输出。代理的思考实时展开——不用盯着空白屏幕等完整响应。推理时旋转动画，首 token 到达瞬间切换输出。</td></tr>
<tr><td><b>全文会话搜索</b></td><td>每段对话被 SQLite FTS5 + Unicode61 分词索引。<code>/search exploit</code>、<code>/search AES</code>、<code>/search 0x4A2F</code>——毫秒级跨所有会话查找任何讨论内容。</td></tr>
</table>

---

## 快速安装

```bash
git clone https://github.com/your-org/skeleton.git
cd skeleton
pnpm install
```

> **前置条件：** [Node.js](https://nodejs.org) >= 22 和 [pnpm](https://pnpm.io)（或使用 `npx pnpm`）。

在项目根目录创建 `.env`：

```bash
SKELETON_PROTOCOL=anthropic
SKELETON_API_KEY=sk-ant-...
SKELETON_BASE_URL=https://api.anthropic.com
SKELETON_MODEL=claude-sonnet-4-5-20250514
```

开始聊天：

```bash
npm run cli
```

> **Base URL 规则：** 设置 URL 到 `/v1` **之前**的部分，SDK 自动拼接 `/v1`。
>
> | 服务商 | 协议 | Base URL |
> |---|---|---|
> | OpenAI | openai | `https://api.openai.com` |
> | Anthropic | anthropic | `https://api.anthropic.com` |
> | Fireworks AI | anthropic | `https://api.fireworks.ai/inference` |
> | OpenRouter | openai | `https://openrouter.ai/api` |
> | Together AI | openai | `https://api.together.xyz` |
> | 本地 vLLM | openai | `http://localhost:8000` |
> | Ollama | openai | `http://localhost:11434` |

---

## 快速开始

```bash
npm run cli                                                    # 交互式 REPL — 开始对话
npx tsx packages/cli/src/bin.ts "分析这段: mov eax, [ebp+8]"    # 一次性流式查询
npm run tg                                                     # 启动 Telegram 网关
```

## CLI vs Telegram 快速参考

Skeleton 有两个入口：终端 UI 通过 `npm run cli`，Telegram 网关通过 `npm run tg`。进入对话后，斜杠命令在两个界面通用。

| 操作 | CLI | Telegram |
|------|-----|----------|
| 开始聊天 | `npm run cli` | 设置 `SKELETON_TG_TOKEN`，运行 `npm run tg`，给机器人发消息 |
| 新建会话 | `/new` | `/new` |
| 重置对话 | `/reset` | `/reset` |
| 查看对话历史 | `/history` | `/history` |
| 查看记忆 | `/memory` | `/memory` |
| 手动保存记忆 | `/remember <文本>` | `/remember <文本>` |
| 按关键词删除记忆 | `/forget <关键词>` | `/forget <关键词>` |
| 搜索历史会话 | `/search <查询>` | `/search <查询>` |
| 查看模型和会话信息 | `/model` | `/model` |
| 退出 | `/quit` 或 `/exit` | — |

---

## 架构

```
  ┌─────────┐    ┌─────────┐
  │   CLI   │    │   TG    │
  └────┬────┘    └────┬────┘
       │              │
       └──────┬───────┘
              │
        ┌─────▼─────┐
        │   Agent   │  ← fallback 路由、工具循环、自动记忆
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

       │ Transport 层 │
  ┌────┴──────────────┴────┐
  │                        │
  ▼                        ▼
OpenAI                 Anthropic
Chat Completions       Messages API
```

| 包 | 功能 |
|---|---|
| `@skeleton/core` | 代理引擎 — 传输层抽象（OpenAI + Anthropic）、记忆库（SQLite + FTS5）、会话 DB（SQLite + WAL）、工具注册表、配置加载 |
| `@skeleton/cli` | 终端 TUI — REPL 方框输入、流式输出、旋转动画、语法高亮 Markdown、金色钥匙 logo |
| `@skeleton/tg` | Telegram 网关 — grammy 机器人、与 CLI 共享记忆库 |

---

## 记忆系统

Skeleton 的记忆是一个**闭环学习系统**——不是简单的聊天日志，而是一个不断积累的知识库，让代理每会话都更聪明：

1. **自动提取** — 代理扫描每条回复中的逆向关键词（`vulnerability`、`exploit`、`offset`、`address`、`function`、`algorithm`、`key`、`decrypt`、`encrypt`、`hash`、`struct`、`protocol`、`format`、`header`，以及中文对等词 `漏洞`、`偏移`、`地址`、`函数`、`算法`、`密钥`、`加密`）。包含这些词的行自动存入知识库。
2. **自动去重** — 插入前 `MemoryStore.exists()` 检查 40 字符前缀是否已存在。不会堆积重复，没有知识腐烂。
3. **上下文注入** — 每轮对话时 `buildContext()` 按 `use_count` 排名选取 top 记忆，估算 token 开销，在 `## Memories` 标题下注入系统提示。高频知识优先于过期条目。
4. **跨会话 + 跨平台** — 记忆在 `.skeleton/memory.db` 中跨 CLI 重启持久化，并与 Telegram 网关共享。终端上的发现在手机上可用，反之亦然。
5. **FTS5 搜索** — `memories_fts` 使用 `unicode61` 分词。`/search` 清理特殊字符，拆分为词，用 OR 连接——所以 `/search AES 加密` 会找到包含 "AES" 或 "加密" 的任何记忆。
6. **手动控制** — `/remember <文本>` 强制保存（`source=manual`），`/forget <关键词>` 按 LIKE 匹配清理，`/memory` 查看所有条目。

---

## 配置

### 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `SKELETON_PROTOCOL` | 是 | `openai` 或 `anthropic` |
| `SKELETON_API_KEY` | 是 | 你的 API 密钥 |
| `SKELETON_BASE_URL` | 是 | 基础 URL——`/v1` 之前的全部内容 |
| `SKELETON_MODEL` | 是 | 模型名（如 `gpt-4o`、`claude-sonnet-4-5-20250514` 或自定义模型） |
| `SKELETON_TG_TOKEN` | 仅 TG | 来自 [@BotFather](https://t.me/BotFather) 的 Telegram 机器人 token |
| `SKELETON_TG_ALLOWED_USERS` | 仅 TG | 谁能跟机器人对话：`*` = 所有人（默认），或逗号分隔 user ID（如 `123456,789012`）= 白名单 |
| `SKELETON_TG_GROUP_MODE` | 仅 TG | 群组行为：`off` = 不回群消息，`mention` = 仅 @时回复（默认），`all` = 所有消息都回 |
| `SKELETON_TG_REACTIONS` | 仅 TG | 消息表情反馈（👀 处理中 / 👍 成功 / 👎 失败）：`true` = 开启（默认），`false` = 关闭 |

### YAML 配置

创建 `skeleton.yaml` 作为 `.env` 的替代：

```yaml
protocol: anthropic
apiKey: sk-ant-...
baseUrl: https://api.anthropic.com
model: claude-sonnet-4-5-20250514
```

### 备用 Provider

设置第二个 provider——主 provider 失败时自动切换：

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

## 技术栈

| 层级 | 选型 | 原因 |
|---|---|---|
| 语言 | TypeScript 5.8 | 类型安全、生态、全栈单语言 |
| 单仓 | pnpm workspaces | 清晰的包边界、共享开发依赖 |
| LLM — OpenAI | `openai` SDK | Chat Completions API + 原生流式 |
| LLM — Anthropic | `@anthropic-ai/sdk` | Messages API + `messages.stream()` |
| 持久化 | `better-sqlite3` + WAL | 零配置、同步、快速、可靠 |
| 搜索 | SQLite FTS5 + unicode61 | 内置全文搜索、无外部依赖 |
| CLI 渲染 | readline + chalk + ANSI | 不用 Ink/React——原生终端控制 |
| Markdown | `marked` + `cli-highlight` | 终端内语法高亮代码块 |
| Telegram | `grammy` | 轻量、类型安全的机器人框架 |

---

## 参与贡献

```bash
git clone https://github.com/your-org/skeleton.git
cd skeleton
pnpm install
npm run cli     # 测试 REPL
npm run test    # 运行测试
npm run build   # 构建所有包
```

---

## 许可证

MIT — 详见 [LICENSE](LICENSE)。
