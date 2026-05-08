import type { ToolDef } from "../../types.js";

let lastSearchTime = 0;
const MIN_INTERVAL = 1000;

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

/** Brave Search API (free tier: 2000 queries/month) */
async function searchBrave(query: string, apiKey: string, limit: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
  const resp = await fetch(url, {
    headers: { "X-Subscription-Token": apiKey, "Accept": "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Brave API error: ${resp.status}`);
  const data = await resp.json() as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  return (data.web?.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.description ?? "",
  }));
}

/** SearXNG self-hosted instance */
async function searchSearXng(query: string, baseUrl: string, limit: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&limit=${limit}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`SearXNG error: ${resp.status}`);
  const data = await resp.json() as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
  }));
}

/** DuckDuckGo HTML search (no API key needed) */
async function searchDuckDuckGo(query: string, limit: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
  // Try duck-duck-scrape first (optional peer dep)
  try {
    const { search } = await import("duck-duck-scrape");
    const results = await search(query, { maxResults: limit });
    if (results && results.length > 0) {
      return results.slice(0, limit).map((r: { title: string; url: string; description: string }) => ({
        title: r.title,
        url: r.url ?? r.href ?? "",
        snippet: r.description ?? r.body ?? "",
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

  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const resultRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

  const titles: Array<{ url: string; title: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = resultRegex.exec(html)) !== null) {
    titles.push({ url: m[1], title: stripTags(m[2]) });
  }

  const snippets: string[] = [];
  while ((m = snippetRegex.exec(html)) !== null) {
    snippets.push(stripTags(m[1]));
  }

  for (let i = 0; i < Math.min(titles.length, limit); i++) {
    results.push({
      title: titles[i].title,
      url: titles[i].url,
      snippet: snippets[i] ?? "",
    });
  }

  return results;
}

export function webSearchTool(): ToolDef {
  return {
    name: "web_search",
    description:
      "Search the web using multiple backends (Brave/DuckDuckGo/SearXNG) with auto-fallback. " +
      "No API key required for DuckDuckGo. Set SKELETON_BRAVE_API_KEY for Brave, " +
      "SKELETON_SEARXNG_URL for SearXNG. Returns titles, URLs, and snippets.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query string",
        },
        max_results: {
          type: "number",
          default: 10,
          description: "Maximum number of results (1-20)",
        },
        backend: {
          type: "string",
          enum: ["brave", "duckduckgo", "searxng"],
          description: "Preferred backend (default: auto-select from available)",
        },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const { query, max_results = 10, backend } = args as {
        query: string;
        max_results?: number;
        backend?: string;
      };

      if (!query.trim()) return { error: "Empty query" };
      const limit = Math.min(Math.max(1, max_results), 20);

      // Rate limit
      const now = Date.now();
      const wait = MIN_INTERVAL - (now - lastSearchTime);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastSearchTime = Date.now();

      // Build backend priority
      const braveApiKey = process.env.SKELETON_BRAVE_API_KEY ?? "";
      const searxngUrl = process.env.SKELETON_SEARXNG_URL ?? "";

      type Backend = "brave" | "duckduckgo" | "searxng";
      const backends: Backend[] = [];
      if (backend === "brave" && braveApiKey) backends.push("brave");
      else if (backend === "searxng" && searxngUrl) backends.push("searxng");
      else if (backend === "duckduckgo") backends.push("duckduckgo");
      else {
        // Auto-select: prefer Brave if key available, then DDG, then SearXNG
        if (braveApiKey) backends.push("brave");
        backends.push("duckduckgo");
        if (searxngUrl) backends.push("searxng");
      }

      let lastErr: Error | null = null;
      for (const be of backends) {
        try {
          let results: Array<{ title: string; url: string; snippet: string }>;
          switch (be) {
            case "brave":
              results = await searchBrave(query, braveApiKey, limit);
              break;
            case "searxng":
              results = await searchSearXng(query, searxngUrl, limit);
              break;
            case "duckduckgo":
            default:
              results = await searchDuckDuckGo(query, limit);
              break;
          }
          if (results.length === 0) {
            lastErr = new Error("No results from " + be);
            continue;
          }
          return results;
        } catch (err) {
          lastErr = err as Error;
          console.warn(`Search backend "${be}" failed: ${lastErr.message}, trying next`);
        }
      }

      return { error: `All search backends failed: ${lastErr?.message ?? "unknown"}` };
    },
    toolset: "web",
    emoji: "🔍",
  };
}
