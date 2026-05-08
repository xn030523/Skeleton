export type Protocol = "openai" | "anthropic";

export interface LLMConfig {
  protocol: Protocol;
  apiKey: string;
  baseUrl: string;
  model: string;
  maxTokens?: number;
  temperature?: number;
}

export interface AgentConfig {
  llm: LLMConfig;
  fallback?: LLMConfig;
  maxTurns?: number;
  systemPrompt?: string;
  tools?: ToolDef[];
  skills?: import("./skills/index.js").SkillConfig;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
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
