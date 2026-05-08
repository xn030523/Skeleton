import type { ToolDef } from "../../types.js";
import { isUrlSafe } from "../security.js";

type PlaywrightModule = typeof import("playwright");
type Browser = Awaited<ReturnType<PlaywrightModule["chromium"]["launch"]>>;
type Page = Awaited<ReturnType<Browser["newPage"]>>;

let pw: PlaywrightModule | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
let initPromise: Promise<void> | null = null;

const SNAPSHOT_MAX = 50000;

async function ensureBrowser(headless: boolean): Promise<Page> {
  if (page && !page.isClosed()) return page;

  if (initPromise) await initPromise;

  if (page && !page.isClosed()) return page;

  initPromise = (async () => {
    try {
      pw = await import("playwright");
    } catch {
      throw new Error(
        "browser tool requires playwright. Install with:\n  pnpm add playwright\n  npx playwright install chromium",
      );
    }

    browser = await pw.chromium.launch({ headless });
    const ctx = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    });
    page = await ctx.newPage();
  })();

  try {
    await initPromise;
  } finally {
    initPromise = null;
  }

  return page!;
}

async function getPage(): Promise<Page | null> {
  if (page && !page.isClosed()) return page;
  return null;
}

export function browserTool(): ToolDef {
  return {
    name: "browser",
    description:
      "Browser automation via Playwright. Actions: navigate, snapshot, click, type, scroll, back, press, close. Requires optional 'playwright' package. Use for web research, form interaction, JavaScript-heavy pages, and screenshot capture.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["navigate", "snapshot", "click", "type", "scroll", "back", "press", "close"],
          description: "Browser action to perform",
        },
        url: {
          type: "string",
          description: "URL to navigate to (for 'navigate' action)",
        },
        selector: {
          type: "string",
          description: "CSS selector for element (for 'click', 'type' actions)",
        },
        text: {
          type: "string",
          description: "Text to type (for 'type' action)",
        },
        key: {
          type: "string",
          description: "Key to press (for 'press' action): Enter, Tab, Escape, ArrowDown, etc.",
        },
        direction: {
          type: "string",
          enum: ["up", "down"],
          default: "down",
          description: "Scroll direction (for 'scroll' action)",
        },
        amount: {
          type: "number",
          default: 3,
          description: "Scroll amount in viewport heights (for 'scroll' action)",
        },
        headless: {
          type: "boolean",
          default: true,
          description: "Run browser in headless mode (default: true)",
        },
      },
      required: ["action"],
    },
    execute: async (args) => {
      const { action, url, selector, text, key, direction = "down", amount = 3, headless = true } = args as {
        action: string;
        url?: string;
        selector?: string;
        text?: string;
        key?: string;
        direction?: string;
        amount?: number;
        headless?: boolean;
      };

      try {
        switch (action) {
          case "navigate": {
            if (!url) return { error: "Missing 'url' parameter for navigate" };
            if (url.toLowerCase().startsWith("javascript:")) {
              return { error: "BLOCKED: javascript: URI not allowed" };
            }
            const urlCheck = isUrlSafe(url);
            if (!urlCheck.safe) return { error: `BLOCKED: ${urlCheck.reason}` };
            const p = await ensureBrowser(headless);
            const resp = await p.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
            const title = await p.title();
            return {
              url: p.url(),
              title,
              status: resp?.status() ?? 0,
            };
          }

          case "snapshot": {
            const p = await getPage();
            if (!p) return { error: "No active page. Use 'navigate' first." };
            const title = await p.title();
            const bodyText = await p.innerText("body");
            const htmlLen = (await p.content()).length;
            const truncated = bodyText.length > SNAPSHOT_MAX;
            return {
              url: p.url(),
              title,
              text: bodyText.slice(0, SNAPSHOT_MAX),
              html_length: htmlLen,
              truncated,
            };
          }

          case "click": {
            if (!selector) return { error: "Missing 'selector' parameter for click" };
            const p = await getPage();
            if (!p) return { error: "No active page. Use 'navigate' first." };
            await p.click(selector, { timeout: 5000 });
            return { success: true, message: `Clicked: ${selector}` };
          }

          case "type": {
            if (!selector) return { error: "Missing 'selector' parameter for type" };
            if (text === undefined) return { error: "Missing 'text' parameter for type" };
            const p = await getPage();
            if (!p) return { error: "No active page. Use 'navigate' first." };
            await p.fill(selector, text, { timeout: 5000 });
            return { success: true, message: `Typed into: ${selector}` };
          }

          case "scroll": {
            const p = await getPage();
            if (!p) return { error: "No active page. Use 'navigate' first." };
            const viewport = p.viewportSize;
            const scrollPx = (viewport?.height ?? 800) * amount;
            const delta = direction === "up" ? -scrollPx : scrollPx;
            await p.mouse.wheel(0, delta);
            return { success: true, message: `Scrolled ${direction} ${amount} viewport heights` };
          }

          case "back": {
            const p = await getPage();
            if (!p) return { error: "No active page. Use 'navigate' first." };
            await p.goBack({ timeout: 10000 });
            return { success: true, message: "Navigated back" };
          }

          case "press": {
            if (!key) return { error: "Missing 'key' parameter for press" };
            const p = await getPage();
            if (!p) return { error: "No active page. Use 'navigate' first." };
            await p.keyboard.press(key);
            return { success: true, message: `Pressed: ${key}` };
          }

          case "close": {
            if (page) { await page.close().catch(() => {}); page = null; }
            if (browser) { await browser.close().catch(() => {}); browser = null; }
            pw = null;
            return { success: true };
          }

          default:
            return { error: `Unknown action: ${action}. Supported: navigate, snapshot, click, type, scroll, back, press, close` };
        }
      } catch (err) {
        const msg = (err as Error).message;

        if (msg.includes("Target closed") || msg.includes("Browser closed") || msg.includes("disconnected")) {
          page = null;
          browser = null;
          pw = null;
          return { error: `Browser session lost. Retry with 'navigate' to re-open: ${msg}` };
        }

        return { error: `Browser action failed: ${msg}` };
      }
    },
  };
}
