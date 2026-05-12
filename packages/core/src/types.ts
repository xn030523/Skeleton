export type Protocol = "openai" | "anthropic";

export type ReasoningEffort = "low" | "medium" | "high";

export interface LLMConfig {
  protocol: Protocol;
  apiKey: string;
  baseUrl: string;
  model: string;
  provider?: string;
  maxTokens?: number;
  temperature?: number;
  reasoningEffort?: ReasoningEffort;
  apiKeys?: string[];
  credentialStrategy?: import("./credential-pool.js").PoolStrategy;
}

export interface AgentConfig {
  llm: LLMConfig;
  fallback?: LLMConfig;
  maxTurns?: number;
  systemPrompt?: string;
  tools?: ToolDef[];
  skills?: import("./skills/index.js").SkillConfig;
  compression?: {
    enabled?: boolean;
    threshold?: number;
    targetRatio?: number;
    protectLastN?: number;
    toolOutputThreshold?: number;
    toolOutputHead?: number;
    toolOutputTail?: number;
  };
  /** Agent 行为控制 (Phase 2) */
  behavior?: {
    /** 单次 run() 执行超时（毫秒）。0 = 无限制。 */
    timeoutMs?: number;
    /** API 调用失败时的最大重试次数（默认 3） */
    apiMaxRetries?: number;
    /** 重试之间的基础退避时间（毫秒，默认 1000） */
    retryBackoffMs?: number;
    /** 工具调用强制模式：auto（默认） | true | false */
    toolUseEnforcement?: "auto" | boolean;
    /** 长任务状态通知间隔（毫秒，默认 0 = 禁用） */
    notifyIntervalMs?: number;
  };
  /** 工具输出限制 (Phase 4) */
  toolOutput?: {
    /** terminal 工具输出上限（字符，默认 50000） */
    maxBytes?: number;
    /** read_file 分页上限（行数，默认 2000） */
    maxLines?: number;
    /** 单行长度上限（字符，默认 2000） */
    maxLineLength?: number;
    /** 单轮所有 tool 结果总字节预算，超出时最大的非持久化结果会溢出到磁盘（默认 200000） */
    turnBudgetBytes?: number;
    /** 持久化后返回给 LLM 的预览大小（字符，默认 1500） */
    previewSize?: number;
  };
  /** 文件读取限制 (Phase 4) */
  fileRead?: {
    /** 单次 read_file 字符上限（默认 100000） */
    maxChars?: number;
  };
  /** 辅助模型系统 (Phase 3) — 不同任务使用不同模型 */
  auxiliary?: {
    /** 视觉分析模型 */
    vision?: AuxiliaryModelConfig;
    /** 上下文压缩模型 */
    compression?: AuxiliaryModelConfig;
    /** 网页提取模型 */
    webExtract?: AuxiliaryModelConfig;
    /** 标题生成模型 */
    titleGeneration?: AuxiliaryModelConfig;
    /** 判决模型（Goal 系统用） */
    judge?: AuxiliaryModelConfig;
    /** 错误分类模型 */
    errorClassifier?: AuxiliaryModelConfig;
  };
}

/** 辅助模型配置（用于不同子任务） */
export interface AuxiliaryModelConfig {
  /** Provider 名称（deepseek, openrouter, anthropic 等）| "auto" = 使用主模型 */
  provider?: string | "auto";
  /** 具体 model 名（覆盖 provider 默认） */
  model?: string;
  /** 直接指定 baseUrl（优先级最高） */
  baseUrl?: string;
  /** 独立 apiKey（空 = 从 provider env var 读取） */
  apiKey?: string;
  /** 超时（毫秒，默认 120000） */
  timeoutMs?: number;
  /** 额外请求体字段（provider-specific） */
  extraBody?: Record<string, unknown>;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
  toolset?: string;
  emoji?: string;
}

export interface NormalizedResponse {
  content: string;
  toolCalls?: ToolCall[];
  usage?: Usage;
  finishReason: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}
