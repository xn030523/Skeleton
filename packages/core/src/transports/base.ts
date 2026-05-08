import type { Message, NormalizedResponse } from "../types.js";

export interface Transport {
  send(systemPrompt: string, messages: Message[]): Promise<NormalizedResponse>;
  sendStream(
    systemPrompt: string,
    messages: Message[],
    onToken: (token: string) => void,
  ): Promise<NormalizedResponse>;
}
