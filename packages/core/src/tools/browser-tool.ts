import type { ToolDef } from "../types.js";
import { isUrlSafe } from "./security.js";

type CdpConnection = { ws: string; id: number };
type PageState = { url: string; title: string };

const cdpConnections = new Map<string, CdpConnection>();
let cdpPageInfo: PageState | null = null;

async function cdpSend(wsUrl: string, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const id = (cdpConnections.get(wsUrl)?.id ?? 0) + 1;
  cdpConnections.set(wsUrl, { ws: wsUrl, id });

  const { WebSocket } = await import("ws");
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error("CDP timeout"));
    }, 15000);

    ws.once("open", () => {
      ws.send(JSON.stringify({ id, method, params }));
    });

    ws.once("message", (data: Buffer) => {
      clearTimeout(timeout);
      ws.close();
      try {
        const msg = JSON.parse(data.toString());
        resolve(msg.result ?? msg);
      } catch {
        reject(new Error("Invalid CDP response"));
      }
    });

    ws.once("error", (err: Error) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

type PlaywrightModule = typeof import("playwright");
type Browser = Awaited<ReturnType<PlaywrightModule["chromium"]["launch"]>>;
type Page = Awaited<ReturnType<Browser["newPage"]>>;

let pw: PlaywrightModule | null = null;
let browser: Browser | null = null;
let page: Page | null = null;
let initPromise: Promise<void> | null = null;

async function ensurePlaywrightBrowser(headless: boolean): Promise<Page> {
  if (page && !page.isClosed()) return page;
  if (initPromise) await initPromise;
  if (page && !page.isClosed()) return page;

  initPromise = (async () => {
    try {
      pw = await import("playwright");
    } catch {
      throw new Error("browser tool requires playwright. Install with: pnpm add playwright && npx playwright install chromium");
    }
    browser = await pw.chromium.launch({ headless });
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
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

function getPlaywrightPage(): Page | null {
  if (page && !page.isClosed()) return page;
  return null;
}

export function browserTool(): ToolDef {
  return {
    name: "browser",
    description:
      "Browser automation via Playwright or CDP. Actions: navigate, screenshot, click, type, scroll, evaluate. " +
      "Set SKELETON_BROWSER_BACKEND=playwright (default) or cdp. For CDP, also set SKELETON_CDP_WS_URL.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["navigate", "screenshot", "click", "type", "scroll", "evaluate"],
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
        js: {
          type: "string",
          description: "JavaScript to evaluate (for 'evaluate' action)",
        },
        fullPage: {
          type: "boolean",
          default: false,
          description: "Capture full page screenshot (for 'screenshot' action)",
        },
      },
      required: ["action"],
    },
    execute: async (args) => {
      const {
        action,
        url,
        selector,
        text,
        js,
        fullPage = false,
      } = args as {
        action: string;
        url?: string;
        selector?: string;
        text?: string;
        js?: string;
        fullPage?: boolean;
      };

      const backend = process.env.SKELETON_BROWSER_BACKEND ?? "playwright";

      try {
        if (backend === "cdp") {
          return await handleCdpAction(action, url, selector, text, js);
        }
        return await handlePlaywrightAction(action, url, selector, text, js, fullPage);
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
    toolset: "browser",
  };
}

async function handlePlaywrightAction(
  action: string,
  url?: string,
  selector?: string,
  text?: string,
  js?: string,
  fullPage?: boolean,
): Promise<unknown> {
  switch (action) {
    case "navigate": {
      if (!url) return { error: "Missing 'url' parameter for navigate" };
      if (url.toLowerCase().startsWith("javascript:")) return { error: "BLOCKED: javascript: URI not allowed" };
      const urlCheck = isUrlSafe(url);
      if (!urlCheck.safe) return { error: `BLOCKED: ${urlCheck.reason}` };
      const p = await ensurePlaywrightBrowser(true);
      const resp = await p.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
      const title = await p.title();
      return { url: p.url(), title, status: resp?.status() ?? 0 };
    }

    case "screenshot": {
      const p = getPlaywrightPage();
      if (!p) return { error: "No active page. Use 'navigate' first." };
      const buffer = await p.screenshot({ fullPage, type: "png" });
      return {
        url: p.url(),
        title: await p.title(),
        screenshot_base64: buffer.toString("base64"),
        size_bytes: buffer.length,
      };
    }

    case "click": {
      if (!selector) return { error: "Missing 'selector' parameter for click" };
      const p = getPlaywrightPage();
      if (!p) return { error: "No active page. Use 'navigate' first." };
      await p.click(selector, { timeout: 5000 });
      return { success: true, message: `Clicked: ${selector}` };
    }

    case "type": {
      if (!selector) return { error: "Missing 'selector' parameter for type" };
      if (text === undefined) return { error: "Missing 'text' parameter for type" };
      const p = getPlaywrightPage();
      if (!p) return { error: "No active page. Use 'navigate' first." };
      await p.fill(selector, text, { timeout: 5000 });
      return { success: true, message: `Typed into: ${selector}` };
    }

    case "scroll": {
      const p = getPlaywrightPage();
      if (!p) return { error: "No active page. Use 'navigate' first." };
      await p.mouse.wheel(0, 800);
      return { success: true, message: "Scrolled down one viewport" };
    }

    case "evaluate": {
      if (!js) return { error: "Missing 'js' parameter for evaluate" };
      const p = getPlaywrightPage();
      if (!p) return { error: "No active page. Use 'navigate' first." };
      const result = await p.evaluate(js);
      return { result };
    }

    default:
      return { error: `Unknown action: ${action}. Supported: navigate, screenshot, click, type, scroll, evaluate` };
  }
}

async function handleCdpAction(
  action: string,
  url?: string,
  selector?: string,
  text?: string,
  js?: string,
): Promise<unknown> {
  const wsUrl = process.env.SKELETON_CDP_WS_URL ?? "";
  if (!wsUrl) return { error: "SKELETON_CDP_WS_URL not set for CDP backend" };

  switch (action) {
    case "navigate": {
      if (!url) return { error: "Missing 'url' parameter for navigate" };
      const result = await cdpSend(wsUrl, "Page.navigate", { url }) as { frameId?: string };
      cdpPageInfo = { url, title: "" };
      return { url, frameId: result.frameId ?? "" };
    }

    case "screenshot": {
      const result = await cdpSend(wsUrl, "Page.captureScreenshot", { format: "png" }) as { data?: string };
      return { screenshot_base64: result.data ?? "", url: cdpPageInfo?.url ?? "" };
    }

    case "click": {
      if (!selector) return { error: "Missing 'selector' for click (CDP requires coordinates — use evaluate instead)" };
      const jsResult = await cdpSend(wsUrl, "Runtime.evaluate", {
        expression: `document.querySelector('${selector}')?.click(); 'clicked'`,
      }) as { result?: { value?: string } };
      return { success: true, result: jsResult.result?.value };
    }

    case "type": {
      if (!selector || text === undefined) return { error: "Missing 'selector' or 'text' for type" };
      const jsResult = await cdpSend(wsUrl, "Runtime.evaluate", {
        expression: `const el = document.querySelector('${selector}'); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', {bubbles:true})); 'typed'`,
      }) as { result?: { value?: string } };
      return { success: true, result: jsResult.result?.value };
    }

    case "scroll": {
      await cdpSend(wsUrl, "Runtime.evaluate", {
        expression: "window.scrollBy(0, 800); 'scrolled'",
      });
      return { success: true, message: "Scrolled down" };
    }

    case "evaluate": {
      if (!js) return { error: "Missing 'js' parameter for evaluate" };
      const result = await cdpSend(wsUrl, "Runtime.evaluate", { expression: js, returnByValue: true }) as {
        result?: { value?: unknown };
      };
      return { result: result.result?.value };
    }

    default:
      return { error: `Unknown action: ${action}. Supported: navigate, screenshot, click, type, scroll, evaluate` };
  }
}
