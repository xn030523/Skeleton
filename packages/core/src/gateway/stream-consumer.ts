/**
 * Auxiliary Client Router — multi-provider auxiliary client with
 * per-task overrides and 402/credit exhaustion fallback.
 *
 * Inspired by Hermes auxiliary_client.py (router pattern).
 */

import type { LLMConfig } from "../types.js";
import type { AuxiliaryClient } from "../auxiliary-client.js";

export interface AuxRoute {
  task: string;
  provider?: string;
  model?: string;
  priority?: number;
}

const DEFAULT_ROUTES: AuxRoute[] = [
  { task: "summarize", priority: 0 },
  { task: "vision", priority: 0 },
  { task: "title", priority: 0 },
  { task: "error_classify", priority: 0 },
];

export class AuxiliaryRouter {
  private routes: AuxRoute[] = [];
  private clients = new Map<string, AuxiliaryClient>();
  private exhausted = new Set<string>();

  constructor(routes?: AuxRoute[]) {
    this.routes = [...DEFAULT_ROUTES, ...(routes ?? [])].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  }

  /** Register a client for a provider */
  registerClient(provider: string, client: AuxiliaryClient): void {
    this.clients.set(provider, client);
  }

  /** Route a task to the best available client */
  async route(task: string, prompt: string): Promise<string> {
    const route = this.routes.find(r => r.task === task);
    const preferred = route?.provider;

    // Try preferred provider first
    if (preferred) {
      const client = this.clients.get(preferred);
      if (client && !this.exhausted.has(preferred)) {
        try {
          return await client.summarize(prompt);
        } catch (err) {
          if ((err as { status?: number })?.status === 402) {
            this.exhausted.add(preferred);
          }
        }
      }
    }

    // Fallback to any available provider
    for (const [provider, client] of this.clients) {
      if (this.exhausted.has(provider)) continue;
      try {
        return await client.summarize(prompt);
      } catch (err) {
        if ((err as { status?: number })?.status === 402) {
          this.exhausted.add(provider);
        }
      }
    }

    throw new Error("All auxiliary providers exhausted or unavailable");
  }

  /** Reset exhaustion state */
  resetExhaustion(): void {
    this.exhausted.clear();
  }
}
