import type { ToolDef } from "../../types.js";
import { isUrlSafe } from "../security.js";

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? m[1].replace(/<[^>]+>/g, "").trim() : "";
}

export function webFetchTool(): ToolDef {
  return {
    name: "web_fetch",
    description:
      "Fetch a web page and convert its content to clean markdown. No API key required. Supports HTML, JSON, and plain text. Useful for reading documentation, API references, blog posts, and any web content.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "URL to fetch",
        },
        format: {
          type: "string",
          enum: ["markdown", "text", "raw"],
          default: "markdown",
          description: "Output format: 'markdown' (default), 'text' (plain text), or 'raw' (original body)",
        },
        max_length: {
          type: "number",
          default: 50000,
          description: "Maximum characters to return (default 50000, max 200000)",
        },
      },
      required: ["url"],
    },
    execute: async (args) => {
      const { url, format = "markdown", max_length = 50000 } = args as {
        url: string;
        format?: string;
        max_length?: number;
      };

      if (!url) return { error: "Missing 'url' parameter" };
      const urlCheck = isUrlSafe(url);
      if (!urlCheck.safe) return { error: `BLOCKED: ${urlCheck.reason}` };

      if (!url.trim()) return { error: "Empty URL" };

      let validUrl: URL;
      try {
        validUrl = new URL(url);
      } catch {
        return { error: `Invalid URL: ${url}` };
      }

      if (!["http:", "https:"].includes(validUrl.protocol)) {
        return { error: `Unsupported protocol: ${validUrl.protocol}` };
      }

      const maxLen = Math.min(Math.max(1000, max_length), 200000);

      try {
        const resp = await fetch(url, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
          signal: AbortSignal.timeout(15000),
          redirect: "follow",
        });

        if (!resp.ok) {
          return { error: `HTTP ${resp.status} ${resp.statusText}` };
        }

        const contentType = resp.headers.get("content-type") ?? "";
        const body = await resp.text();

        // JSON response
        if (contentType.includes("application/json")) {
          try {
            const parsed = JSON.parse(body);
            const content = JSON.stringify(parsed, null, 2);
            const truncated = content.length > maxLen;
            return {
              url,
              title: validUrl.hostname,
              content: content.slice(0, maxLen),
              format: "json",
              length: content.length,
              truncated,
            };
          } catch {
            // Not valid JSON, return as text
          }
        }

        // Plain text or non-HTML
        if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
          const truncated = body.length > maxLen;
          return {
            url,
            title: validUrl.hostname,
            content: body.slice(0, maxLen),
            format: "text",
            length: body.length,
            truncated,
          };
        }

        // HTML response
        const title = extractTitle(body);

        if (format === "raw") {
          const truncated = body.length > maxLen;
          return {
            url,
            title,
            content: body.slice(0, maxLen),
            format: "raw",
            length: body.length,
            truncated,
          };
        }

        // Strip unwanted elements before conversion
        let cleaned = body
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<nav[\s\S]*?<\/nav>/gi, "")
          .replace(/<footer[\s\S]*?<\/footer>/gi, "")
          .replace(/<header[\s\S]*?<\/header>/gi, "");

        if (format === "text") {
          const text = cleaned
            .replace(/<br\s*\/?>/gi, "\n")
            .replace(/<\/p>/gi, "\n\n")
            .replace(/<\/div>/gi, "\n")
            .replace(/<\/li>/gi, "\n")
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&nbsp;/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

          const truncated = text.length > maxLen;
          return {
            url,
            title,
            content: text.slice(0, maxLen),
            format: "text",
            length: text.length,
            truncated,
          };
        }

        // Markdown conversion via turndown
        try {
          const TurndownService = (await import("turndown")).default;
          const td = new TurndownService({
            headingStyle: "atx",
            codeBlockStyle: "fenced",
            bulletListMarker: "-",
          });

          td.addRule("remove", {
            filter: ["script", "style", "nav", "footer", "header", "noscript", "iframe"],
            replacement: () => "",
          });

          const markdown = td.turndown(body);
          const truncated = markdown.length > maxLen;
          return {
            url,
            title,
            content: markdown.slice(0, maxLen),
            format: "markdown",
            length: markdown.length,
            truncated,
          };
        } catch {
          // turndown not available, fall back to text extraction
          const text = cleaned
            .replace(/<[^>]+>/g, "")
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">")
            .replace(/&nbsp;/g, " ")
            .trim();

          const truncated = text.length > maxLen;
          return {
            url,
            title,
            content: text.slice(0, maxLen),
            format: "text",
            length: text.length,
            truncated,
          };
        }
      } catch (err) {
        if ((err as Error).name === "AbortError" || (err as Error).name === "TimeoutError") {
          return { error: `Request timed out: ${url}` };
        }
        return { error: `Fetch failed: ${(err as Error).message}` };
      }
    },
  };
}
