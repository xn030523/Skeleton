# Skeleton ↔ Hermes 功能对齐清单

> 基准日期：2026-05-12  
> 对标仓库：`https://github.com/NousResearch/hermes-agent`（克隆到本地 `hermes-ref/`）  
> 对齐原则：**技术架构**全对齐，**业务领域**只做逆向（消息平台 / 商业 skill / 智能家居等明确不做）

---

## 整体状态

| 分类 | 状态 |
|---|---|
| 核心技术栈 | ✅ 已对齐 ~99% |
| P1 待补 | ✅ 全部完成（P1-1/2/3/4） |
| P2 待补 | ✅ 全部完成（P2-1/2/3 补齐；P2-4/5 已有实现） |
| P3 待补 | 🔧 7 项 |
| 明确不做 | 🚫 10+ 项（业务不匹配） |

---

## ✅ 已对齐（主要里程碑）

| 能力 | Hermes | Skeleton |
|---|---|---|
| 4 transport (OpenAI / Anthropic / Codex / Bedrock) | agent/transports/ | transports/ |
| 34 Provider 注册 | providers/ + profiles | providers/ |
| MCP host + OAuth | tools/mcp_*.py | mcp/ |
| 5 层 Memory | agent/memory_manager.py + memory_provider.py | memory/ |
| Context compression | agent/context_compressor.py | context/ |
| Skill 全套（registry / hub / guard / provenance / usage / preprocess） | tools/skill_*.py + skills/ | skills/ |
| **Skill catalog progressive disclosure + 跨进程 snapshot** | agent/prompt_builder.py | skills/registry.ts |
| **Curator 自动触发**（idle-based） | agent/curator.py | skills/curator-scheduler.ts |
| **Background Review 自动学习** | run_agent.py `_spawn_background_review` | skills/background-review.ts |
| Sub-agent 派生 | tools/delegate_tool.py | sub-agent/ |
| Hook 系统 7 事件 | agent/shell_hooks.py | hooks.ts |
| Plugin 系统 | plugins/ | plugin-system.ts |
| Cron | cron/ + tools/cronjob_tools.py | cron/ |
| Goal/Ralph Loop | run_agent.py | goals/ |
| Session DB + FTS5 | hermes_state.py | session/ |
| Trajectory compression | trajectory_compressor.py | trajectory-compressor.ts |
| Credential Pool | agent/credential_pool.py | credential-pool.ts |
| Auxiliary Client | agent/auxiliary_client.py | auxiliary-client.ts |
| Error classifier | agent/error_classifier.py | errors/ |
| Rate limit tracker | agent/rate_limit_tracker.py | （内置） |
| Snapshot + Checkpoint | 内嵌 | snapshot.ts + checkpoint.ts |
| Think scrubber | agent/think_scrubber.py | think-scrubber.ts |
| i18n 9 语言 | agent/i18n.py | （有） |
| Insights | agent/insights.py | agent-status.ts |
| Skin/theme | agent/display.py | skin.ts |
| Personality (SOUL.md) | 内嵌 | personality/ |
| Onboarding | agent/onboarding.py | onboarding.ts |
| PTC（parallel tool calls） | 内嵌 | ptc.ts |
| MoA | tools/mixture_of_agents_tool.py | moa.ts |
| RL training | rl_cli.py | rl.ts + rl-training.ts |
| Sandbox（Daytona/Modal/Singularity/Vercel） | tools/environments/ | sandbox.ts |
| Tool output limits | tools/tool_output_limits.py | tools/output-limits.ts |
| ACP server | acp_adapter/ | acp/ |
| API server | 内嵌 | api-server.ts |
| Approval / Path security / URL safety / Schema sanitizer | tools/*.py | tools/*.ts |
| Guardrails | agent/tool_guardrails.py | tools/guardrails |
| Website policy | tools/website_policy.py | tools/website-policy |
| Env passthrough + Credential files | tools/env_passthrough.py / credential_files.py | tools/env-passthrough + credential-files |
| OSV security | tools/osv_check.py | osv-security.ts |
| Redact | agent/redact.py | redact.ts |
| Model metadata | agent/model_metadata.py + models_dev.py | model-catalog.ts + model-prompts.ts |
| 8 Tool-call parser | 内嵌 transport | tool-call-parsers/ |
| Account usage | agent/account_usage.py | account-usage.ts |
| **File Operations 套件**（read/write/edit/patch/search + fuzzy 9 策略 + V4A patch + file-state） | tools/file_operations.py + file_tools.py + file_state.py + patch_parser.py + fuzzy_match.py + binary_extensions.py | tools/file-operations.ts + file-tools.ts + file-state.ts + patch-parser.ts + fuzzy-match.ts + binary-extensions.ts ✅ |
| **Tool Result Storage ref 机制**（Layer 2 + Layer 3，含 persisted-output tag） | tools/tool_result_storage.py + budget_config.py | tools/output-limits.ts（重写 + 挂进 agent.ts）✅ |
| **Vision 多模态分析工具**（HTTP+file://+path+data URI，50MB 上限，website-policy，Anthropic/OpenAI 分岔） | tools/vision_tools.py | tools/vision-tool.ts（重写）+ auxiliary-client.ts（直接 HTTP 多模态）✅ |
| **Code Execution (PTC)**（LLM 写 Python 脚本；父端 UDS/TCP RPC server 派发；7 工具 stub） | tools/code_execution_tool.py | tools/code-execution.ts ✅ |

---

## 🔧 P1 待补（3 项，技术骨架关键）

### ~~P1-1. File Operations 套件~~ ✅ 已完成（2026-05-12）

实施结果：
- `packages/core/src/tools/binary-extensions.ts` — 67 种二进制扩展名（PDF 排除）
- `packages/core/src/tools/fuzzy-match.ts` — 9 策略链（exact / line_trimmed / whitespace / indent / escape / trim_boundary / unicode / block_anchor / context_aware）含 escape-drift 保护
- `packages/core/src/tools/file-state.ts` — FileStateRegistry 单例，Node async mutex 替代 threading.Lock，recordRead/noteWrite/checkStale/lockPath 完整语义
- `packages/core/src/tools/patch-parser.ts` — V4A 两阶段 validate-then-apply，Update/Add/Delete/Move + context hint window 重试
- `packages/core/src/tools/file-operations.ts` — LocalFileOperations 本地 fs 实现；SKELETON_WRITE_SAFE_ROOT + denied paths/prefixes 写入护栏；readFile 分页 + 行号前缀；typo 相似路径建议
- `packages/core/src/tools/file-tools.ts` — 5 个 LLM 工具：read_file / write_file / edit_file / patch_file / search_files，挂入 builtInTools()

远程 backend（docker/ssh/modal/daytona/vercel sandbox）透明适配留 P2 后续做——Hermes `ShellFileOperations` 抽象后续按需补。

---

### P1-2. Code Execution Tool

**Hermes 文件**：
- `tools/code_execution_tool.py` — 独立于 terminal 的代码执行，核心是 **PTC（Programmatic Tool Calling）**

**核心设计点**（**这一项比较复杂，先看源码再动手**）：
1. 目的：让 LLM 写一段 Python 脚本**在脚本内调用其他 Hermes 工具**，collapse 多步 tool chain 到单次推理
2. 两种 transport：
   - **本地后端**：UDS（Unix Domain Socket）RPC—— 父进程开 socket，子进程跑脚本，脚本 import `hermes_tools` stub，工具调用通过 UDS 回到父进程派发
   - **远程后端**：file-based RPC—— 请求/响应文件 + 父进程轮询
3. Windows 用 loopback TCP 替代 UDS
4. 沙箱白名单：`SANDBOX_ALLOWED_TOOLS` 限制哪些工具能在脚本里被调用（7 个核心）
5. 只返回脚本 stdout 给 LLM，中间 tool 结果**不进入** context window

**Skeleton 目标**：
- `packages/core/src/tools/code-execution/index.ts` — 工具注册 + 主入口
- `packages/core/src/tools/code-execution/rpc-server.ts` — UDS/TCP RPC 监听 + 派发
- `packages/core/src/tools/code-execution/stub-generator.ts` — 生成 `skeleton_tools.ts`/`.py` stub 让子进程 import
- `packages/core/src/tools/code-execution/sandbox-allowlist.ts` — 允许调用工具白名单

**注意不要编**：
- 先读 Hermes 源码的 UDS 协议格式（请求帧 / 响应帧 / 错误帧）再定设计
- Skeleton 已有 `ptc.ts`（parallel tool calls）和 `tools/sandbox-terminal.ts`，这项是**新独立工具**，别和那俩混淆
- 不是"用 child_process exec python 脚本" 那么简单——是要建 RPC 桥让子进程能 call tool

---

### P1-3. Tool Result Storage（大输出落盘 + ref 回显）

**Hermes 文件**：
- `tools/tool_result_storage.py` — `maybe_persist_tool_result` + `enforce_turn_budget`
- `tools/budget_config.py` — `DEFAULT_BUDGET` + `DEFAULT_PREVIEW_SIZE_CHARS` + `BudgetConfig`

**核心设计点**：
1. **三层防护**：
   - Layer 1：每个工具自己截断（第一道）
   - Layer 2：`maybe_persist_tool_result` —— 单个结果超过注册阈值，全文写入 `$TMPDIR/hermes-results/{tool_use_id}.txt`，LLM 看到的是 **preview + 文件引用**
   - Layer 3：`enforce_turn_budget` —— 整轮 tool 结果聚合超 200k 字符，挑最大的非持久化结果溢出到磁盘
2. **持久化格式**：
   - 输出被 `<persisted-output>...preview...</persisted-output>` 包裹
   - LLM 后续可以 `read_file` 访问全文（在 sandbox 里用相同路径）
3. **heredoc 动态 marker**：避免 content 里包含 `HERMES_PERSIST_EOF` 导致 heredoc 破损
4. **stdin pipe 优先**：大内容走 stdin 而不是 argv（`MAX_ARG_STRLEN` 128KB 限制）

**Skeleton 目标**：
- `packages/core/src/tools/tool-result-storage.ts` — `maybePersistToolResult` + `enforceTurnBudget`
- `packages/core/src/tools/budget-config.ts` — 已有但要扩展：加 `DEFAULT_PREVIEW_SIZE_CHARS` 和 `MAX_TURN_BUDGET_CHARS` 常量
- 挂到 agent.ts 的 tool 收尾钩子：每个 tool 结果算一次 `maybePersist`，一轮结束算一次 `enforceTurnBudget`
- 持久化目录：`~/.skeleton/tool-results/{tool_call_id}.txt`（对齐 Hermes 的 `hermes-results`）

**现有差距**：
- Skeleton 已有 `tools/tool-result-persist.ts`（持久化）和 `tools/output-limits.ts`（截断）
- **缺**：ref 机制——LLM 看到 preview 后可以用 `<ref>xxx</ref>` 取全文；turn-aggregate budget 自动溢出；heredoc 动态 marker

**注意不要编**：
- 预览大小常量必须和 Hermes 一致（`DEFAULT_PREVIEW_SIZE_CHARS`），别瞎写一个数
- storage 目录路径必须和 `persistToolResult` 现有行为对齐，不要创建两个并行目录

---

### P1-4. Vision Tool 完整实现

**Hermes 文件**：
- `tools/vision_tools.py` — `vision_analyze_tool`
- 走 `agent/auxiliary_client.py` 的 vision route（支持 OpenRouter / Nous / Codex / Anthropic / 自定义 OpenAI 兼容）

**核心设计点**：
1. 入参：`image_url` + `user_prompt`
2. 下载 → base64 → 通过 auxiliary 路由调 LLM
3. 安全：`check_website_access`（website_policy）过滤域名；50MB 下载硬上限；30s 下载超时（可配置 `HERMES_VISION_DOWNLOAD_TIMEOUT`）
4. 支持本地文件（`file://` 或绝对路径）→ 直接 base64
5. 临时文件自动清理

**Skeleton 现状**：
- agent.ts 挂了 `vision` 工具名，**没实际实现**
- `auxiliary-client.ts` 有 vision 路由字段，但没被工具使用

**Skeleton 目标**：
- `packages/core/src/tools/vision.ts` — `visionAnalyzeTool(registry)` 返回 ToolDef
- 复用 `auxiliary-client.ts` 的 `callAux("vision", ...)` 路由
- 复用 `tools/url-safety.ts` 的 website-policy 检查
- `SKELETON_VISION_DOWNLOAD_TIMEOUT` env 变量 + `auxiliary.vision.downloadTimeout` config 字段

**注意不要编**：
- base64 编码 + data URL 格式必须和各 provider 兼容（Anthropic `type: "image"` + `source.type: "base64"`；OpenAI `image_url.url: "data:image/..."`）—— 先看 Hermes 怎么分岔，别写死一套
- 50MB 是 Hermes 硬编码的 `_VISION_MAX_DOWNLOAD_BYTES`，保持一致

---

## 🔧 P2 待补（5 项，体验优化）

### P2-1. Manual Compression Feedback

**Hermes 文件**：`agent/manual_compression_feedback.py`

**核心**：`/compress --instructions "..."` 支持 —— 生成 user-facing 反馈字符串：
- `Compressed: {before} → {after} messages`
- `Approx request size: ~{before_tok:,} → ~{after_tok:,} tokens`
- noop 检测（内容完全没变）+ 反直觉 note（消息少了但 token 反而多了的解释）

**Skeleton 目标**：
- `packages/core/src/context/manual-feedback.ts`
- `/compress [focus]` 命令已有，扩展：消息前后对比计数 + 反馈拼接
- 支持 `--instructions` 参数透传给 `compressor.compress(focus, instructions)`

---

### P2-2. Gemini Native Adapter

**Hermes 文件**：
- `agent/gemini_native_adapter.py` — OpenAI-compat facade over `models/{model}:generateContent`
- `agent/gemini_schema.py` — `sanitize_gemini_tool_parameters`（Gemini tool schema 严格限制）
- `agent/google_oauth.py` — OAuth flow
- `agent/gemini_cloudcode_adapter.py` — Google CloudCode 专用

**核心**：
1. Gemini 的 OpenAI 兼容层不稳（auth 抖、tool-call replay 问题、thought-signature）
2. Native endpoint `models/{model}:generateContent` 是唯一靠谱路径
3. 把 OpenAI `messages[]` + `tools[]` 转成 Gemini `contents[]` + `tools[]`（格式差很远）
4. Schema sanitize：Gemini 不支持 `anyOf` / `additionalProperties` / 很多 JSON Schema 特性，要清洗

**Skeleton 目标**：
- `packages/core/src/transports/gemini-native.ts` — 独立 Transport 实现
- `packages/core/src/providers/gemini-schema-sanitizer.ts` —— JSON Schema 清洗
- provider profile `gemini` 增加 `apiMode: "gemini_native"` 选项

**当前 Skeleton 状态**：
- provider profile 已定义 `gemini`，走 ChatCompletionsTransport + OpenAI 兼容层（即 Hermes 说的"不稳那条"）
- 缺 native transport

---

### P2-3. Camofox Browser Backend

**Hermes 文件**：
- `tools/browser_camofox.py` — REST 客户端
- `tools/browser_camofox_state.py` — 身份状态（cookie / UA / fingerprint seed）
- `CAMOFOX_URL` env var 切换

**核心**：
1. Camoufox = Firefox fork + C++ 级指纹伪造
2. Camofox-browser = 自托管 Node.js REST 服务包装 Camoufox
3. `CAMOFOX_URL=http://localhost:9377` 就切换到这个后端
4. REST API 1:1 对应 playwright 的 accessibility snapshot / click-by-ref / screenshot
5. 逆向反爬场景价值高

**Skeleton 目标**：
- `packages/core/src/tools/browser/camofox-backend.ts` — REST client
- 在现有 browser supervisor 里加 `backend: "camofox"` 选项
- env: `SKELETON_CAMOFOX_URL`

---

### P2-4. Image Generation Tool

**Hermes 文件**：
- `tools/image_generation_tool.py`
- `agent/image_gen_provider.py`
- `agent/image_gen_registry.py`
- `agent/image_routing.py`

**核心**：多 provider 注册（OpenAI DALL-E / FAL / Nano Banana / Ideogram 等）+ 路由策略

**Skeleton 目标**：
- `packages/core/src/tools/image-gen.ts` + `image-gen-providers.ts` + `image-gen-router.ts`

**优先级低**：逆向场景不常用；但 Hermes 有完整栈，对齐需要

---

### P2-5. Transcription（STT）

**Hermes 文件**：`tools/transcription_tools.py`

**核心**：Whisper / GroqWhisper 等 STT provider 路由

**Skeleton 目标**：`packages/core/src/tools/transcription.ts`（当前已挂名未实现）

---

## 🔧 P3 待补（7 项，边缘）

| 项 | Hermes 文件 | 优先级极低理由 |
|---|---|---|
| P3-1 LMStudio reasoning adapter | agent/lmstudio_reasoning.py | LM Studio 的 reasoning 字段特殊，Skeleton 多数用户用 OpenAI-compat 够了 |
| P3-2 Moonshot schema adapter | agent/moonshot_schema.py | Kimi 工具 schema 特殊处理 |
| P3-3 Nous rate guard | agent/nous_rate_guard.py | Nous provider 专属速率保护 |
| P3-4 Copilot ACP client | agent/copilot_acp_client.py | Copilot 走 ACP 协议而不是直接 API |
| P3-5 Computer-use tool | tools/computer_use_tool.py | 桌面直接控制，逆向用 CDP browser 替代够用 |
| P3-6 TTS 本地后端完整接入 | tools/neutts_* | 本地 TTS 需要额外依赖 |
| P3-7 Tirith 安全扫描 | tools/tirith_security.py | 和 skill guard 重叠 |

---

## 🚫 明确不做（业务不匹配）

| 项 | 理由 |
|---|---|
| Discord / Slack / Teams / Feishu / WhatsApp / Signal / Matrix / Mattermost | 规则：只做 CLI + TG |
| Homeassistant 插件 | 智能家居非逆向 |
| Shopify / here.now / shop-app / financial-services bundle | 商业生产力非逆向 |
| Spotify / google_meet / teams_pipeline 插件 | 同上 |
| Yuanbao / 微信 / QQ Bot / Google Chat | 消息平台 |
| Microsoft Graph | 商业 API |
| Google Code Assist | 商业 API |
| p5js / manim-video / popular-web-designs | 创意工具非逆向 |
| research-paper-writing | 学术非逆向 |
| Achievements / Badges 游戏化 | UX 游戏化 |
| `hermes claw migrate` | Skeleton 无前身 |
| BlueBubbles / SMS / Email Gateway | 消息平台 |
| NixOS 管理 | 平台管理非逆向 |
| Kanban Dashboard Web UI | 用户明确不要 Web UI |
| xAI Custom Voices（voice clone） | 语音特效非核心 |

---

## 实施顺序建议

按"对逆向工程价值"排序：

1. **P1-1 File Operations 套件** — 改 skill.md / exploit 脚本 / writeup 的底层操作
2. **P1-3 Tool Result Storage ref 机制** — `hexdump` / `strings` / `disassemble` 的大输出必需
3. **P1-4 Vision** — 看靶机截图 / UI 逆向截图
4. **P1-2 Code Execution (PTC)** — 跑 pwntools / crypto oracle 复合流程
5. **P2-1 Manual Compression** — 体验优化
6. **P2-3 Camofox** — 反爬场景
7. **P2-2 Gemini Native** — Gemini provider 稳定性
8. 剩余按需

---

## 实施纪律

- **每项开工前**：先完整读 Hermes 源码 3 个关键文件（模块主文件 + 它引用的 helper + 使用方），把 API 形状 / 常量 / 错误路径看清楚。**禁止凭印象写**。
- **Skeleton 目标文件名**一律参照本文档，不要自创路径。
- **常量 / 默认值 / 超时 / 路径**必须照搬 Hermes（如 `~/.skeleton/tool-results/`、50MB 下载硬上限、`DEFAULT_PREVIEW_SIZE_CHARS`），不要自己编数字。
- **遇到不清楚的设计点**：在 md 里标 `❓ 待确认` 再继续，不要自己想一个合理方案就写。
- **每做完一项**：从 P1/P2/P3 清单移到已对齐表，在本文档顶部"整体状态"更新计数。
- **提交 commit message**：不提 Hermes 名字（规则硬性）。
