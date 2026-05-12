/**
 * Camofox browser backend — anti-detection browser via REST API.
 *
 * Port of Hermes `tools/browser_camofox.py`.
 *
 * Camofox-browser is a self-hosted Node.js server wrapping Camoufox
 * (Firefox fork with C++ fingerprint spoofing). It exposes a REST API
 * that maps 1:1 to our browser tool interface.
 *
 * Setup:
 *   git clone https://github.com/jo-inc/camofox-browser && cd camofox-browser
 *   npm install && npm start   # downloads Camoufox (~300MB) on first run
 *   # or: docker run -p 9377:9377 -e CAMOFOX_PORT=9377 jo-inc/camofox-browser
 *
 * Then set SKELETON_CAMOFOX_URL=http://localhost:9377 in ~/.skeleton/.env
 *
 * When SKELETON_BROWSER_BACKEND=camofox and SKELETON_CAMOFOX_URL is set,
 * all browser tool calls route through this module.
 */

import crypto from "node:crypto";

const DEFAULT_TIMEOUT_MS = 30_000;
const SNAPSHOT_MAX_CHARS = 80_000;

// ── Config ────────────────────────────────────────────────────────────

export function getCamofoxUrl(): string {
  return (process.env.SKELETON_CAMOFOX_URL ?? "").replace(/\/+$/, "");
}

export function isCamofoxMode(): boolean {
  // CDP override takes priority over Camofox.
  if (process.env.SKELETON_CDP_WS_URL?.trim()) return false;
  return Boolean(getCamofoxUrl());
}

function isManagedPersistence(): boolean {
  return (process.env.SKELETON_CAMOFOX_MANAGED_PERSISTENCE ?? "").toLowerCase() === "true";
}

// ── VNC URL probe (cached per process) ───────────────────────────────

let _vncUrl: string | null = null;
let _vncChecked = false;

export async function checkCamofoxAvailable(): Promise<boolean> {
  const base = getCamofoxUrl();
  if (!base) return false;
  try {
    const resp = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5_000) });
    if (resp.ok && !_vncChecked) {
      try {
        const data = await resp.json() as { vncPort?: number };
        if (typeof data.vncPort === "number" && data.vncPort >= 1 && data.vncPort <= 65535) {
          const host = new URL(base).hostname;
          _vncUrl = `http://${host}:${data.vncPort}`;
        }
      } catch { /* non-critical */ }
      _vncChecked = true;
    }
    return resp.ok;
  } catch {
    return false;
  }
}

export function getVncUrl(): string | null {
  return _vncUrl;
}

// ── Session management ────────────────────────────────────────────────

interface CamofoxSession {
  userId: string;
  tabId: string | null;
  sessionKey: string;
  managed: boolean;
}

const _sessions = new Map<string, CamofoxSession>();

function getSession(taskId: string): CamofoxSession {
  const existing = _sessions.get(taskId);
  if (existing) return existing;

  let session: CamofoxSession;
  if (isManagedPersistence()) {
    // Deterministic userId from taskId so the server maps to a persistent profile.
    const userId = `skeleton_${crypto.createHash("sha256").update(taskId).digest("hex").slice(0, 16)}`;
    session = {
      userId,
      tabId: null,
      sessionKey: `task_${taskId.slice(0, 16)}`,
      managed: true,
    };
  } else {
    session = {
      userId: `skeleton_${crypto.randomBytes(5).toString("hex")}`,
      tabId: null,
      sessionKey: `task_${taskId.slice(0, 16)}`,
      managed: false,
    };
  }
  _sessions.set(taskId, session);
  return session;
}

async function ensureTab(taskId: string, url = "about:blank"): Promise<CamofoxSession> {
  const session = getSession(taskId);
  if (session.tabId) return session;
  const base = getCamofoxUrl();
  const resp = await fetch(`${base}/tabs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: session.userId, sessionKey: session.sessionKey, url }),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Camofox tab creation failed: HTTP ${resp.status}`);
  const data = await resp.json() as { tabId?: string };
  session.tabId = data.tabId ?? null;
  return session;
}

function dropSession(taskId: string): CamofoxSession | undefined {
  const s = _sessions.get(taskId);
  _sessions.delete(taskId);
  return s;
}

// ── HTTP helpers ──────────────────────────────────────────────────────

async function cfPost(path: string, body: Record<string, unknown>): Promise<unknown> {
  const base = getCamofoxUrl();
  const resp = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Camofox POST ${path} failed: HTTP ${resp.status}`);
  return resp.json();
}

async function cfGet(path: string, params?: Record<string, string>): Promise<unknown> {
  const base = getCamofoxUrl();
  const url = new URL(`${base}${path}`);
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`Camofox GET ${path} failed: HTTP ${resp.status}`);
  return resp.json();
}

async function cfDelete(path: string): Promise<void> {
  const base = getCamofoxUrl();
  await fetch(`${base}${path}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
}

// ── Snapshot truncation ───────────────────────────────────────────────

function truncateSnapshot(snapshot: string, maxChars = SNAPSHOT_MAX_CHARS): string {
  if (snapshot.length <= maxChars) return snapshot;
  const head = snapshot.slice(0, Math.floor(maxChars * 0.7));
  const tail = snapshot.slice(-Math.floor(maxChars * 0.3));
  const omitted = snapshot.length - head.length - tail.length;
  return `${head}\n\n[... ${omitted} chars omitted — use a more specific action to target elements ...]\n\n${tail}`;
}

// ── Action handlers ───────────────────────────────────────────────────

export async function camofoxNavigate(url: string, taskId: string): Promise<unknown> {
  const session = getSession(taskId);
  if (!session.tabId) {
    // Create tab with target URL directly.
    const s = await ensureTab(taskId, url);
    const result: Record<string, unknown> = { success: true, url };
    const vnc = getVncUrl();
    if (vnc) {
      result.vncUrl = vnc;
      result.vncHint = "Browser is visible via VNC. Share this link with the user to watch live.";
    }
    // Auto-snapshot after navigation.
    try {
      const snap = await cfGet(`/tabs/${s.tabId}/snapshot`, { userId: s.userId }) as { snapshot?: string; refsCount?: number };
      result.snapshot = truncateSnapshot(snap.snapshot ?? "");
      result.elementCount = snap.refsCount ?? 0;
    } catch { /* non-critical */ }
    return result;
  }
  const data = await cfPost(`/tabs/${session.tabId}/navigate`, { userId: session.userId, url }) as { url?: string; title?: string };
  const result: Record<string, unknown> = { success: true, url: data.url ?? url, title: data.title ?? "" };
  const vnc = getVncUrl();
  if (vnc) result.vncUrl = vnc;
  // Auto-snapshot.
  try {
    const snap = await cfGet(`/tabs/${session.tabId}/snapshot`, { userId: session.userId }) as { snapshot?: string; refsCount?: number };
    result.snapshot = truncateSnapshot(snap.snapshot ?? "");
    result.elementCount = snap.refsCount ?? 0;
  } catch { /* non-critical */ }
  return result;
}

export async function camofoxSnapshot(taskId: string): Promise<unknown> {
  const session = getSession(taskId);
  if (!session.tabId) return { error: "No browser session. Call navigate first." };
  const data = await cfGet(`/tabs/${session.tabId}/snapshot`, { userId: session.userId }) as { snapshot?: string; refsCount?: number };
  return {
    success: true,
    snapshot: truncateSnapshot(data.snapshot ?? ""),
    elementCount: data.refsCount ?? 0,
  };
}

export async function camofoxScreenshot(taskId: string): Promise<unknown> {
  const session = getSession(taskId);
  if (!session.tabId) return { error: "No browser session. Call navigate first." };
  const base = getCamofoxUrl();
  const resp = await fetch(`${base}/tabs/${session.tabId}/screenshot?userId=${session.userId}`, {
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  if (!resp.ok) throw new Error(`Screenshot failed: HTTP ${resp.status}`);
  const buf = Buffer.from(await resp.arrayBuffer());
  return { screenshotBase64: buf.toString("base64"), sizeBytes: buf.length };
}

export async function camofoxClick(ref: string, taskId: string): Promise<unknown> {
  const session = getSession(taskId);
  if (!session.tabId) return { error: "No browser session. Call navigate first." };
  const cleanRef = ref.replace(/^@/, "");
  const data = await cfPost(`/tabs/${session.tabId}/click`, { userId: session.userId, ref: cleanRef }) as { url?: string };
  return { success: true, clicked: cleanRef, url: data.url ?? "" };
}

export async function camofoxType(ref: string, text: string, taskId: string): Promise<unknown> {
  const session = getSession(taskId);
  if (!session.tabId) return { error: "No browser session. Call navigate first." };
  const cleanRef = ref.replace(/^@/, "");
  await cfPost(`/tabs/${session.tabId}/type`, { userId: session.userId, ref: cleanRef, text });
  return { success: true, typed: text, element: cleanRef };
}

export async function camofoxScroll(direction: string, taskId: string): Promise<unknown> {
  const session = getSession(taskId);
  if (!session.tabId) return { error: "No browser session. Call navigate first." };
  await cfPost(`/tabs/${session.tabId}/scroll`, { userId: session.userId, direction });
  return { success: true, scrolled: direction };
}

export async function camofoxBack(taskId: string): Promise<unknown> {
  const session = getSession(taskId);
  if (!session.tabId) return { error: "No browser session. Call navigate first." };
  const data = await cfPost(`/tabs/${session.tabId}/back`, { userId: session.userId }) as { url?: string };
  return { success: true, url: data.url ?? "" };
}

export async function camofoxPress(key: string, taskId: string): Promise<unknown> {
  const session = getSession(taskId);
  if (!session.tabId) return { error: "No browser session. Call navigate first." };
  await cfPost(`/tabs/${session.tabId}/press`, { userId: session.userId, key });
  return { success: true, pressed: key };
}

export async function camofoxClose(taskId: string): Promise<unknown> {
  const session = dropSession(taskId);
  if (!session) return { success: true, closed: true };
  try {
    await cfDelete(`/sessions/${session.userId}`);
  } catch { /* best-effort */ }
  return { success: true, closed: true };
}

// ── Unified action dispatcher ─────────────────────────────────────────

export async function handleCamofoxAction(
  action: string,
  taskId: string,
  opts: {
    url?: string;
    selector?: string;
    text?: string;
    direction?: string;
    key?: string;
  } = {},
): Promise<unknown> {
  const { url, selector, text, direction, key } = opts;

  if (!getCamofoxUrl()) {
    return { error: "SKELETON_CAMOFOX_URL is not set. Start camofox-browser and set the env var." };
  }

  switch (action) {
    case "navigate":
      if (!url) return { error: "Missing 'url' for navigate" };
      return camofoxNavigate(url, taskId);
    case "snapshot":
      return camofoxSnapshot(taskId);
    case "screenshot":
      return camofoxScreenshot(taskId);
    case "click":
      if (!selector) return { error: "Missing 'selector' for click" };
      return camofoxClick(selector, taskId);
    case "type":
      if (!selector || text === undefined) return { error: "Missing 'selector' or 'text' for type" };
      return camofoxType(selector, text, taskId);
    case "scroll":
      return camofoxScroll(direction ?? "down", taskId);
    case "back":
      return camofoxBack(taskId);
    case "press":
      if (!key) return { error: "Missing 'key' for press" };
      return camofoxPress(key, taskId);
    case "close":
      return camofoxClose(taskId);
    case "evaluate":
      return { error: "Camofox does not support JS evaluation — use snapshot to inspect the page" };
    default:
      return { error: `Unknown action: ${action}. Camofox supports: navigate, snapshot, screenshot, click, type, scroll, back, press, close` };
  }
}
