import type { ToolDef } from "../types.js";
import { isUrlSafe } from "./security.js";
import { cdpSupervisor } from "./browser-supervisor.js";

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
      "Browser automation via Playwright, CDP, or CamoFox. Actions: navigate, screenshot, click, type, scroll, evaluate, snapshot, back, close. " +
      "Set SKELETON_BROWSER_BACKEND=playwright (default), cdp, or camofox. For CDP, use /browser connect first.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["navigate", "screenshot", "click", "type", "scroll", "evaluate", "snapshot", "back", "close"],
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
        direction: {
          type: "string",
          enum: ["up", "down"],
          default: "down",
          description: "Scroll direction (for 'scroll' action)",
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
        direction = "down",
      } = args as {
        action: string;
        url?: string;
        selector?: string;
        text?: string;
        js?: string;
        fullPage?: boolean;
        direction?: string;
      };

      const backend = process.env.SKELETON_BROWSER_BACKEND ?? "playwright";

      try {
        if (backend === "cdp") {
          return await handleCdpAction(action, url, selector, text, js, fullPage, direction);
        }
        if (backend === "camofox") {
          return await handleCamoFoxAction(action, url, selector, text, js, direction);
        }
        return await handlePlaywrightAction(action, url, selector, text, js, fullPage, direction);
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
  direction?: string,
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
      const delta = direction === "up" ? -800 : 800;
      await p.mouse.wheel(0, delta);
      return { success: true, message: `Scrolled ${direction}` };
    }

    case "evaluate": {
      if (!js) return { error: "Missing 'js' parameter for evaluate" };
      const p = getPlaywrightPage();
      if (!p) return { error: "No active page. Use 'navigate' first." };
      const result = await p.evaluate(js);
      return { result };
    }

    case "snapshot": {
      const p = getPlaywrightPage();
      if (!p) return { error: "No active page. Use 'navigate' first." };
      const bodyText = await p.innerText("body").catch(() => "");
      const truncated = bodyText.slice(0, 50000);
      return { text: truncated, html_length: bodyText.length, url: p.url() };
    }

    case "back": {
      const p = getPlaywrightPage();
      if (!p) return { error: "No active page. Use 'navigate' first." };
      await p.goBack({ timeout: 10000 }).catch(() => null);
      return { url: p.url(), title: await p.title() };
    }

    case "close": {
      if (page) { await page.close().catch(() => {}); page = null; }
      if (browser) { await browser.close().catch(() => {}); browser = null; }
      pw = null;
      return { success: true, message: "Browser closed" };
    }

    default:
      return { error: `Unknown action: ${action}. Supported: navigate, screenshot, click, type, scroll, evaluate, snapshot, back, close` };
  }
}

async function handleCdpAction(
  action: string,
  url?: string,
  selector?: string,
  text?: string,
  js?: string,
  fullPage?: boolean,
  direction?: string,
): Promise<unknown> {
  if (!cdpSupervisor.isConnected()) {
    return { error: "CDP not connected. Use /browser connect <ws-url> first." };
  }

  switch (action) {
    case "navigate": {
      if (!url) return { error: "Missing 'url' parameter for navigate" };
      if (url.toLowerCase().startsWith("javascript:")) return { error: "BLOCKED: javascript: URI not allowed" };
      const result = await cdpSupervisor.send("Page.navigate", { url }) as Record<string, unknown>;
      await cdpSupervisor.send("Runtime.evaluate", { expression: "document.title", returnByValue: true })
        .then(r => r as Record<string, unknown>)
        .catch(() => null);
      const titleResult = await cdpSupervisor.send("Runtime.evaluate", {
        expression: "document.title",
        returnByValue: true,
      }).catch(() => ({ result: { value: "" } })) as { result?: { value?: string } };
      return { url, title: titleResult.result?.value ?? "", frameId: result.frameId ?? "" };
    }

    case "screenshot": {
      const result = await cdpSupervisor.send("Page.captureScreenshot", {
        format: "png",
      }) as { data?: string };
      return { screenshot_base64: result.data ?? "", size_bytes: result.data ? Buffer.byteLength(result.data, "base64") : 0 };
    }

    case "click": {
      if (!selector) return { error: "Missing 'selector' for click" };
      const safeSelector = JSON.stringify(selector);
      const result = await cdpSupervisor.send("Runtime.evaluate", {
        expression: `document.querySelector(${safeSelector})?.click(); 'clicked'`,
        returnByValue: true,
      }) as { result?: { value?: string } };
      return { success: true, result: result.result?.value };
    }

    case "type": {
      if (!selector || text === undefined) return { error: "Missing 'selector' or 'text' for type" };
      const safeSelector = JSON.stringify(selector);
      const safeText = JSON.stringify(text);
      const result = await cdpSupervisor.send("Runtime.evaluate", {
        expression: `const el = document.querySelector(${safeSelector}); if(el){el.focus();el.value=${safeText};el.dispatchEvent(new Event('input',{bubbles:true}));} 'typed'`,
        returnByValue: true,
      }) as { result?: { value?: string } };
      return { success: true, result: result.result?.value };
    }

    case "scroll": {
      const delta = direction === "up" ? -800 : 800;
      await cdpSupervisor.send("Runtime.evaluate", {
        expression: `window.scrollBy(0, ${delta}); 'scrolled'`,
        returnByValue: true,
      });
      return { success: true, message: `Scrolled ${direction}` };
    }

    case "evaluate": {
      if (!js) return { error: "Missing 'js' parameter for evaluate" };
      const result = await cdpSupervisor.send("Runtime.evaluate", {
        expression: js,
        returnByValue: true,
      }) as { result?: { value?: unknown }; exceptionDetails?: unknown };
      if (result.exceptionDetails) {
        return { error: "Evaluation threw an exception", exceptionDetails: result.exceptionDetails };
      }
      return { result: result.result?.value };
    }

    case "snapshot": {
      const result = await cdpSupervisor.send("Runtime.evaluate", {
        expression: "document.body?.innerText?.slice(0, 50000) ?? ''",
        returnByValue: true,
      }) as { result?: { value?: string } };
      return { text: result.result?.value ?? "", url: "" };
    }

    case "back": {
      await cdpSupervisor.send("Page.navigateToHistoryEntry", { entryId: -1 }).catch(() => {
        return cdpSupervisor.send("Runtime.evaluate", { expression: "history.back(); 'back'", returnByValue: true });
      });
      return { success: true, message: "Navigated back" };
    }

    case "close": {
      cdpSupervisor.disconnect();
      return { success: true, message: "CDP disconnected" };
    }

    default:
      return { error: `Unknown action: ${action}. Supported: navigate, screenshot, click, type, scroll, evaluate, snapshot, back, close` };
  }
}

const CAMOFOX_DEFAULT = "http://localhost:9223";

async function handleCamoFoxAction(
  action: string,
  url?: string,
  selector?: string,
  text?: string,
  js?: string,
  direction?: string,
): Promise<unknown> {
  const base = process.env.SKELETON_CAMOFOX_URL ?? CAMOFOX_DEFAULT;
  const sessionId = process.env.SKELETON_CAMOFOX_SESSION ?? "default";

  async function cfPost(path: string, body?: Record<string, unknown>): Promise<unknown> {
    const resp = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    return resp.json();
  }

  async function cfGet(path: string): Promise<unknown> {
    const resp = await fetch(`${base}${path}`);
    return resp.json();
  }

  const tabPath = `/sessions/${sessionId}/tabs/current`;

  switch (action) {
    case "navigate": {
      if (!url) return { error: "Missing 'url' for navigate" };
      return await cfPost(`${tabPath}/navigate`, { url });
    }
    case "snapshot": {
      return await cfGet(`${tabPath}/snapshot`);
    }
    case "screenshot": {
      const resp = await fetch(`${base}${tabPath}/screenshot`);
      const buf = Buffer.from(await resp.arrayBuffer());
      return { screenshot_base64: buf.toString("base64"), size_bytes: buf.length };
    }
    case "click": {
      if (!selector) return { error: "Missing 'selector' for click" };
      return await cfPost(`${tabPath}/click`, { ref: selector });
    }
    case "type": {
      if (!selector || text === undefined) return { error: "Missing 'selector' or 'text' for type" };
      return await cfPost(`${tabPath}/type`, { ref: selector, text });
    }
    case "scroll": {
      return await cfPost(`${tabPath}/scroll`, { direction: direction ?? "down" });
    }
    case "back": {
      return await cfPost(`${tabPath}/back`);
    }
    case "close": {
      await fetch(`${base}/sessions/${sessionId}`, { method: "DELETE" });
      return { success: true, message: "CamoFox session closed" };
    }
    case "evaluate": {
      if (!js) return { error: "CamoFox does not support evaluate — use snapshot instead" };
      return { error: "CamoFox does not support JS evaluation" };
    }
    default:
      return { error: `Unknown action: ${action}. CamoFox supports: navigate, snapshot, screenshot, click, type, scroll, back, close` };
  }
}
