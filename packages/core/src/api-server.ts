/**
 * OpenAI-compatible HTTP API server.
 *
 * Exposes Skeleton Agent via /v1/chat/completions endpoint
 * for programmatic access. Supports streaming (SSE) and
 * non-streaming modes.
 *
 * Inspired by Hermes gateway API server platform (simplified).
 */

import http from "node:http";
import type { AgentConfig } from "./types.js";
import { Agent } from "./agent.js";
import { MemoryStore } from "./memory/store.js";
import { UserProfile } from "./memory/user-profile.js";

export interface ApiServerConfig {
  port?: number;
  host?: string;
  maxConcurrent?: number;
  agentConfig: AgentConfig;
}

interface ChatRequest {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  stream?: boolean;
  max_tokens?: number;
  temperature?: number;
}

export class ApiServer {
  private server: http.Server | null = null;
  private memory?: MemoryStore;
  private userProfile?: UserProfile;
  private activeRequests = 0;

  constructor(private config: ApiServerConfig, memory?: MemoryStore, userProfile?: UserProfile) {
    this.memory = memory;
    this.userProfile = userProfile;
  }

  /** Start the API server */
  start(): Promise<number> {
    return new Promise((resolve) => {
      this.server = http.createServer(async (req, res) => {
        await this.handleRequest(req, res);
      });

      const port = this.config.port ?? 3000;
      const host = this.config.host ?? "0.0.0.0";

      this.server.listen(port, host, () => {
        console.log(`Skeleton API server listening on ${host}:${port}`);
        resolve(port);
      });
    });
  }

  /** Stop the API server */
  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (url === "/v1/models" && method === "GET") {
        this.handleModels(res);
        return;
      }

      if (url === "/v1/chat/completions" && method === "POST") {
        if (this.activeRequests >= (this.config.maxConcurrent ?? 10)) {
          res.writeHead(429, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: { message: "Too many concurrent requests", type: "rate_limit" } }));
          return;
        }
        await this.handleChatCompletions(req, res);
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: "Not found", type: "invalid_request" } }));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: (err as Error).message, type: "server_error" } }));
    }
  }

  private handleModels(res: http.ServerResponse): void {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      object: "list",
      data: [{
        id: this.config.agentConfig.llm.model,
        object: "model",
        owned_by: "skeleton",
      }],
    }));
  }

  private async handleChatCompletions(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const request = JSON.parse(body) as ChatRequest;

    // Extract last user message
    const userMessages = request.messages.filter(m => m.role === "user");
    const lastUserMsg = userMessages[userMessages.length - 1]?.content ?? "";

    const agent = new Agent(
      this.config.agentConfig,
      this.memory ?? undefined,
      this.userProfile ?? undefined,
    );

    this.activeRequests++;

    try {
      if (request.stream) {
        // SSE streaming
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        });

        const result = await agent.runStream(lastUserMsg, (token) => {
          const chunk = {
            id: `chatcmpl-${Date.now().toString(36)}`,
            object: "chat.completion.chunk",
            choices: [{ index: 0, delta: { content: token }, finish_reason: null }],
          };
          res.write(`data: ${JSON.stringify(chunk)}\n\n`);
        });

        // Final chunk
        const finalChunk = {
          id: `chatcmpl-${Date.now().toString(36)}`,
          object: "chat.completion.chunk",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        };
        res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      } else {
        // Non-streaming
        const result = await agent.run(lastUserMsg);
        const response = {
          id: `chatcmpl-${Date.now().toString(36)}`,
          object: "chat.completion",
          choices: [{
            index: 0,
            message: { role: "assistant", content: result },
            finish_reason: "stop",
          }],
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      }
    } finally {
      this.activeRequests--;
      await agent.close();
    }
  }

  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => resolve(body));
      req.on("error", reject);
    });
  }
}
