import type { ToolDef } from "../types.js";
import {
  getSearchProvider,
  listSearchProviders,
  getConfiguredProvidersSorted,
} from "./web-search-providers.js";

let lastSearchTime = 0;
const MIN_INTERVAL = 1000;

export function webSearchTool(): ToolDef {
  return {
    name: "web_search",
    description:
      "Search the web using multiple backends with auto-fallback. " +
      "Backends: firecrawl, brave, exa, tavily, duckduckgo, searxng. " +
      "Set SKELETON_FIRECRAWL_API_KEY, SKELETON_BRAVE_API_KEY, SKELETON_EXA_API_KEY, " +
      "SKELETON_TAVILY_API_KEY, SKELETON_SEARXNG_URL as needed. DuckDuckGo requires no key. " +
      "Auto-selects from configured providers (paid first, then free).",
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
          enum: listSearchProviders(),
          description: "Preferred backend (default: auto-select from configured providers)",
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

      // Build provider list
      let providers;
      if (backend) {
        const p = getSearchProvider(backend);
        if (p && p.isConfigured()) {
          providers = [p];
        } else {
          return { error: `Backend "${backend}" is not configured or not found` };
        }
      } else {
        providers = getConfiguredProvidersSorted();
      }

      if (providers.length === 0) {
        return { error: "No search providers configured. Set at least one API key or use DuckDuckGo (no key needed)." };
      }

      let lastErr: Error | null = null;
      for (const provider of providers) {
        try {
          const results = await provider.search(query, limit);
          if (results.length === 0) {
            lastErr = new Error(`No results from ${provider.name}`);
            continue;
          }
          return results;
        } catch (err) {
          lastErr = err as Error;
          console.warn(`Search backend "${provider.name}" failed: ${lastErr.message}, trying next`);
        }
      }

      return { error: `All search backends failed: ${lastErr?.message ?? "unknown"}` };
    },
    toolset: "web",
    emoji: "🔍",
  };
}
