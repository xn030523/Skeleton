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

export function webSearchTool(): ToolDef {
  return {
    name: "web_search",
    description:
      "Search the web using DuckDuckGo. Returns a list of results with titles, URLs, and snippets. No API key required. Use this to find information, documentation, CVE details, exploit references, or any web content.",
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
          description: "Maximum number of results to return (1-20, default 10)",
        },
      },
      required: ["query"],
    },
    execute: async (args) => {
      const { query, max_results = 10 } = args as {
        query: string;
        max_results?: number;
      };

      if (!query.trim()) return { error: "Empty query" };
      const limit = Math.min(Math.max(1, max_results), 20);

      // Rate limit
      const now = Date.now();
      const wait = MIN_INTERVAL - (now - lastSearchTime);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      lastSearchTime = Date.now();

      try {
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

        if (!resp.ok) {
          return { error: `Search failed: HTTP ${resp.status}` };
        }

        const html = await resp.text();

        // Parse DDG HTML results
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

        if (results.length === 0) {
          return { error: "No results found. DuckDuckGo may be rate-limiting requests." };
        }

        return results;
      } catch (err) {
        return { error: `Search failed: ${(err as Error).message}` };
      }
    },
  };
}
