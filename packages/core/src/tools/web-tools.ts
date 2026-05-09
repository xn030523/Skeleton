import type { ToolDef } from "../types.js";

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

type SearchResult = { title: string; url: string; snippet: string };

async function searchBrave(query: string, apiKey: string, limit: number): Promise<SearchResult[]> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`;
  const resp = await fetch(url, {
    headers: { "X-Subscription-Token": apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Brave API error: ${resp.status}`);
  const data = (await resp.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  return (data.web?.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.description ?? "",
  }));
}

async function searchExa(query: string, apiKey: string, limit: number): Promise<SearchResult[]> {
  const resp = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify({ query, numResults: limit, type: "neural", contents: { text: { maxCharacters: 200 } } }),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Exa API error: ${resp.status}`);
  const data = (await resp.json()) as { results?: Array<{ title?: string; url?: string; text?: string }> };
  return (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.text ?? "",
  }));
}

async function searchTavily(query: string, apiKey: string, limit: number): Promise<SearchResult[]> {
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, api_key: apiKey, max_results: limit }),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) throw new Error(`Tavily API error: ${resp.status}`);
  const data = (await resp.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
  }));
}

async function searchSearXng(query: string, baseUrl: string, limit: number): Promise<SearchResult[]> {
  const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&limit=${limit}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`SearXNG error: ${resp.status}`);
  const data = (await resp.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (data.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.content ?? "",
  }));
}

async function searchDuckDuckGo(query: string, limit: number): Promise<SearchResult[]> {
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
    // duck-duck-scrape not installed
  }

  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36" },
    signal: AbortSignal.timeout(15000),
  });
  if (!resp.ok) throw new Error(`DuckDuckGo error: ${resp.status}`);
  const html = await resp.text();

  const results: SearchResult[] = [];
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
    results.push({ title: titles[i].title, url: titles[i].url, snippet: snippets[i] ?? "" });
  }
  return results;
}

type Backend = "brave" | "exa" | "tavily" | "duckduckgo" | "searxng";

const ALL_BACKENDS: Backend[] = ["brave", "exa", "tavily", "duckduckgo", "searxng"];

export function webSearchTool(): ToolDef {
  return {
    name: "web_search",
    description:
      "Search the web using multiple backends with auto-fallback. " +
      "Backends: brave, exa, tavily, duckduckgo, searxng. " +
      "Set SKELETON_BRAVE_API_KEY, SKELETON_EXA_API_KEY, SKELETON_TAVILY_API_KEY, " +
      "SKELETON_SEARXNG_URL as needed. DuckDuckGo requires no key.",
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
          enum: ALL_BACKENDS,
          description: "Preferred backend (default: auto-select from available keys)",
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

      const now = Date.now();
      const wait = MIN_INTERVAL - (now - lastSearchTime);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastSearchTime = Date.now();

      const braveApiKey = process.env.SKELETON_BRAVE_API_KEY ?? "";
      const exaApiKey = process.env.SKELETON_EXA_API_KEY ?? "";
      const tavilyApiKey = process.env.SKELETON_TAVILY_API_KEY ?? "";
      const searxngUrl = process.env.SKELETON_SEARXNG_URL ?? "";

      const backends: Backend[] = [];
      if (backend && ALL_BACKENDS.includes(backend as Backend)) {
        backends.push(backend as Backend);
      } else {
        if (braveApiKey) backends.push("brave");
        if (exaApiKey) backends.push("exa");
        if (tavilyApiKey) backends.push("tavily");
        backends.push("duckduckgo");
        if (searxngUrl) backends.push("searxng");
      }

      let lastErr: Error | null = null;
      for (const be of backends) {
        try {
          let results: SearchResult[];
          switch (be) {
            case "brave":
              results = await searchBrave(query, braveApiKey, limit);
              break;
            case "exa":
              results = await searchExa(query, exaApiKey, limit);
              break;
            case "tavily":
              results = await searchTavily(query, tavilyApiKey, limit);
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
  };
}
