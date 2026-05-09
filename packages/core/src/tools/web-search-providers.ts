/**
 * Web Search Provider interface and registry.
 *
 * Each backend (Brave, Exa, Tavily, DDG, SearXNG, Firecrawl) implements
 * WebSearchProvider with isConfigured() gating and search() returning
 * normalized results with position field.
 */

export interface SearchResult {
  title: string;
  url: string;
  description: string;
  position: number;
}

export interface WebSearchProvider {
  name: string;
  isConfigured(): boolean;
  search(query: string, limit: number): Promise<SearchResult[]>;
}

// ── Registry (lazy init, same pattern as tool-call-parsers) ────────────────

let PROVIDER_REGISTRY: Map<string, WebSearchProvider> | undefined;

function ensureRegistry(): Map<string, WebSearchProvider> {
  if (!PROVIDER_REGISTRY) {
    PROVIDER_REGISTRY = new Map();
    // Register built-in providers in priority order
    const builtins = [
      new FirecrawlSearchProvider(),
      new BraveSearchProvider(),
      new ExaSearchProvider(),
      new TavilySearchProvider(),
      new DuckDuckGoSearchProvider(),
      new SearXNGSearchProvider(),
    ];
    for (const p of builtins) {
      PROVIDER_REGISTRY.set(p.name, p);
    }
  }
  return PROVIDER_REGISTRY;
}

export function registerSearchProvider(p: WebSearchProvider): void {
  ensureRegistry().set(p.name, p);
}

export function getSearchProvider(name: string): WebSearchProvider | undefined {
  return ensureRegistry().get(name);
}

export function listSearchProviders(): string[] {
  return Array.from(ensureRegistry().keys());
}

export function listConfiguredProviders(): string[] {
  return Array.from(ensureRegistry().values())
    .filter(p => p.isConfigured())
    .map(p => p.name);
}

/** Auto-detect priority: paid first, then free. */
export function getConfiguredProvidersSorted(): WebSearchProvider[] {
  const priority = ["firecrawl", "brave", "exa", "tavily", "duckduckgo", "searxng"];
  const configured = listConfiguredProviders();
  return priority
    .filter(name => configured.includes(name))
    .map(name => getSearchProvider(name)!)
    .filter(Boolean);
}

// ── HTML utility ────────────────────────────────────────────────────────────

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

// ── Brave Search ────────────────────────────────────────────────────────────

class BraveSearchProvider implements WebSearchProvider {
  name = "brave";

  isConfigured(): boolean {
    return !!process.env.SKELETON_BRAVE_API_KEY?.trim();
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const apiKey = process.env.SKELETON_BRAVE_API_KEY!.trim();
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
    const resp = await fetch(url, {
      headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Brave API error: ${resp.status}`);
    const data = (await resp.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    };
    return (data.web?.results ?? []).slice(0, limit).map((r, i) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      description: r.description ?? "",
      position: i + 1,
    }));
  }
}

// ── Exa Search ──────────────────────────────────────────────────────────────

class ExaSearchProvider implements WebSearchProvider {
  name = "exa";

  isConfigured(): boolean {
    return !!process.env.SKELETON_EXA_API_KEY?.trim();
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const apiKey = process.env.SKELETON_EXA_API_KEY!.trim();
    const resp = await fetch("https://api.exa.ai/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify({ query, numResults: limit, type: "neural", contents: { text: { maxCharacters: 200 } } }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Exa API error: ${resp.status}`);
    const data = (await resp.json()) as {
      results?: Array<{ title?: string; url?: string; text?: string }>;
    };
    return (data.results ?? []).slice(0, limit).map((r, i) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      description: r.text ?? "",
      position: i + 1,
    }));
  }
}

// ── Tavily Search ───────────────────────────────────────────────────────────

class TavilySearchProvider implements WebSearchProvider {
  name = "tavily";

  isConfigured(): boolean {
    return !!process.env.SKELETON_TAVILY_API_KEY?.trim();
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const apiKey = process.env.SKELETON_TAVILY_API_KEY!.trim();
    const resp = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, api_key: apiKey, max_results: limit }),
      signal: AbortSignal.timeout(10000),
    });
    if (!resp.ok) throw new Error(`Tavily API error: ${resp.status}`);
    const data = (await resp.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (data.results ?? []).slice(0, limit).map((r, i) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      description: r.content ?? "",
      position: i + 1,
    }));
  }
}

// ── SearXNG ─────────────────────────────────────────────────────────────────

class SearXNGSearchProvider implements WebSearchProvider {
  name = "searxng";

  isConfigured(): boolean {
    return !!process.env.SKELETON_SEARXNG_URL?.trim();
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const baseUrl = process.env.SKELETON_SEARXNG_URL!.trim().replace(/\/+$/, "");
    const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
    if (!resp.ok) throw new Error(`SearXNG error: ${resp.status}`);
    const data = (await resp.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
    };
    // Sort by score descending (matches Hermes behavior)
    const sorted = (data.results ?? []).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    return sorted.slice(0, limit).map((r, i) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      description: r.content ?? "",
      position: i + 1,
    }));
  }
}

// ── DuckDuckGo ──────────────────────────────────────────────────────────────

class DuckDuckGoSearchProvider implements WebSearchProvider {
  name = "duckduckgo";

  isConfigured(): boolean {
    return true; // No API key needed
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    // Try duck-duck-scrape first (optional peer dep)
    try {
      const { search } = await import("duck-duck-scrape");
      const results = await search(query, { maxResults: limit });
      if (results && results.length > 0) {
        return results.slice(0, limit).map((r: { title: string; url: string; href?: string; description?: string; body?: string }, i: number) => ({
          title: r.title,
          url: r.url ?? r.href ?? "",
          description: r.description ?? r.body ?? "",
          position: i + 1,
        }));
      }
    } catch {
      // duck-duck-scrape not installed, fall through to HTML scraping
    }

    // Fallback: HTML scraping
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const resp = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`DuckDuckGo error: ${resp.status}`);
    const html = await resp.text();

    const titles: Array<{ url: string; title: string }> = [];
    const snippets: string[] = [];
    const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    let m: RegExpExecArray | null;
    while ((m = resultRegex.exec(html)) !== null) {
      titles.push({ url: m[1], title: stripTags(m[2]) });
    }
    while ((m = snippetRegex.exec(html)) !== null) {
      snippets.push(stripTags(m[1]));
    }

    const results: SearchResult[] = [];
    for (let i = 0; i < Math.min(titles.length, limit); i++) {
      results.push({
        title: titles[i].title,
        url: titles[i].url,
        description: snippets[i] ?? "",
        position: i + 1,
      });
    }
    return results;
  }
}

// ── Firecrawl Search ────────────────────────────────────────────────────────

class FirecrawlSearchProvider implements WebSearchProvider {
  name = "firecrawl";

  isConfigured(): boolean {
    return !!process.env.SKELETON_FIRECRAWL_API_KEY?.trim();
  }

  async search(query: string, limit: number): Promise<SearchResult[]> {
    const apiKey = process.env.SKELETON_FIRECRAWL_API_KEY!.trim();
    const apiUrl = process.env.SKELETON_FIRECRAWL_API_URL?.trim().replace(/\/+$/, "")
      ?? "https://api.firecrawl.dev/v1";

    const resp = await fetch(`${apiUrl}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ query, limit }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      throw new Error(`Firecrawl API error: ${resp.status} ${body.slice(0, 200)}`);
    }
    const data = (await resp.json()) as {
      success?: boolean;
      data?: Array<{ title?: string; url?: string; description?: string; metadata?: { sourceURL?: string } }>;
    };
    const items = data.data ?? [];
    return items.slice(0, limit).map((r, i) => ({
      title: r.title ?? r.metadata?.sourceURL ?? "",
      url: r.url ?? r.metadata?.sourceURL ?? "",
      description: r.description ?? "",
      position: i + 1,
    }));
  }
}
