/**
 * Memory plugin interface — unified abstraction for mem0, supermemory, retaindb, etc.
 * Provides MemoryPlugin interface with Mem0Plugin (API) and InMemoryPlugin (local fallback).
 */

export interface MemoryPlugin {
  readonly name: string;
  store(key: string, value: string): Promise<void>;
  retrieve(key: string): Promise<string | null>;
  search(query: string, limit?: number): Promise<Array<{ key: string; value: string; score: number }>>;
  delete(key: string): Promise<boolean>;
}

export class InMemoryPlugin implements MemoryPlugin {
  readonly name = "inmemory";
  private data: Map<string, string> = new Map();

  async store(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async retrieve(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async search(query: string, limit: number = 5): Promise<Array<{ key: string; value: string; score: number }>> {
    const q = query.toLowerCase();
    const results: Array<{ key: string; value: string; score: number }> = [];
    for (const [key, value] of this.data) {
      const combined = (key + " " + value).toLowerCase();
      let score = 0;
      const words = q.split(/\s+/);
      for (const word of words) {
        if (combined.includes(word)) score += 1;
      }
      if (score > 0) results.push({ key, value, score });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  async delete(key: string): Promise<boolean> {
    return this.data.delete(key);
  }
}

export class Mem0Plugin implements MemoryPlugin {
  readonly name = "mem0";
  private baseUrl: string;
  private apiKey: string | null;

  constructor(config: { baseUrl?: string; apiKey?: string } = {}) {
    this.baseUrl = config.baseUrl ?? "https://api.mem0.ai/v1";
    this.apiKey = config.apiKey ?? null;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) h["Authorization"] = `Bearer ${this.apiKey}`;
    return h;
  }

  async store(key: string, value: string): Promise<void> {
    await fetch(`${this.baseUrl}/memories/`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ content: value, metadata: { key } }),
    });
  }

  async retrieve(key: string): Promise<string | null> {
    const res = await fetch(`${this.baseUrl}/memories/?metadata_key=key&metadata_value=${encodeURIComponent(key)}`, {
      headers: this.headers(),
    });
    if (!res.ok) return null;
    const data = await res.json() as { results?: Array<{ content: string }> };
    return data.results?.[0]?.content ?? null;
  }

  async search(query: string, limit: number = 5): Promise<Array<{ key: string; value: string; score: number }>> {
    const res = await fetch(`${this.baseUrl}/memories/search/`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ query, limit }),
    });
    if (!res.ok) return [];
    const data = await res.json() as { results?: Array<{ content: string; metadata?: { key?: string }; score?: number }> };
    return (data.results ?? []).map(r => ({
      key: r.metadata?.key ?? "",
      value: r.content,
      score: r.score ?? 0,
    }));
  }

  async delete(key: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/memories/?metadata_key=key&metadata_value=${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    return res.ok;
  }
}

/** Create a memory plugin based on config. Falls back to InMemoryPlugin if no external config. */
export function createMemoryPlugin(config?: {
  type?: "mem0" | "inmemory";
  baseUrl?: string;
  apiKey?: string;
}): MemoryPlugin {
  const type = config?.type ?? "inmemory";
  if (type === "mem0") {
    return new Mem0Plugin({ baseUrl: config?.baseUrl, apiKey: config?.apiKey });
  }
  return new InMemoryPlugin();
}
