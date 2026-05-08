import type { Message, NormalizedResponse, ToolDef } from "../types.js";

export interface Transport {
  send(systemPrompt: string, messages: Message[], tools?: ToolDef[]): Promise<NormalizedResponse>;
  sendStream(
    systemPrompt: string,
    messages: Message[],
    onToken: (token: string) => void,
    tools?: ToolDef[],
  ): Promise<NormalizedResponse>;
}
