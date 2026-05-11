/**
 * Unified proxy support — auto-detects system HTTP/HTTPS/SOCKS proxy
 * from standard env vars and applies it globally to fetch + undici.
 *
 * Precedence (first match wins):
 *   1. SKELETON_PROXY (our override)
 *   2. HTTPS_PROXY / https_proxy
 *   3. HTTP_PROXY / http_proxy
 *   4. ALL_PROXY / all_proxy (SOCKS)
 *
 * NO_PROXY / no_proxy is honored for host exclusions.
 */

export interface ProxyConfig {
  url: string;
  type: "http" | "https" | "socks";
  noProxy: string[];
}

export function detectProxy(): ProxyConfig | null {
  const url =
    process.env.SKELETON_PROXY ??
    process.env.HTTPS_PROXY ?? process.env.https_proxy ??
    process.env.HTTP_PROXY ?? process.env.http_proxy ??
    process.env.ALL_PROXY ?? process.env.all_proxy ?? "";

  if (!url) return null;

  let type: ProxyConfig["type"] = "http";
  if (url.startsWith("socks")) type = "socks";
  else if (url.startsWith("https:")) type = "https";
  else if (url.startsWith("http:")) type = "http";

  const noProxyRaw = process.env.NO_PROXY ?? process.env.no_proxy ?? "";
  const noProxy = noProxyRaw.split(",").map(s => s.trim()).filter(Boolean);

  return { url, type, noProxy };
}

/** Apply detected proxy globally to undici (Node fetch) */
export async function applyGlobalProxy(): Promise<ProxyConfig | null> {
  const proxy = detectProxy();
  if (!proxy) return null;

  try {
    if (proxy.type === "socks") {
      // SOCKS needs a separate dispatcher — dynamic import to avoid hard dep
      try {
        const { socksDispatcher } = await import("socks-proxy-agent" as any);
        const undici = await import("undici" as any);
        const dispatcher = new socksDispatcher({ uri: proxy.url });
        undici.setGlobalDispatcher(dispatcher);
      } catch {
        console.warn(`Skeleton: SOCKS proxy detected (${proxy.url}) but socks-proxy-agent not installed — skipping. Install with: npm i socks-proxy-agent`);
      }
    } else {
      const undici = await import("undici" as any);
      const dispatcher = new undici.ProxyAgent({ uri: proxy.url });
      undici.setGlobalDispatcher(dispatcher);
    }
    return proxy;
  } catch (err) {
    console.warn(`Skeleton: failed to apply proxy ${proxy.url}: ${(err as Error).message}`);
    return null;
  }
}

/** Check if a host should bypass the proxy (NO_PROXY list) */
export function shouldBypassProxy(host: string, noProxy: string[]): boolean {
  for (const pattern of noProxy) {
    if (pattern === "*") return true;
    if (pattern.startsWith(".")) {
      if (host.endsWith(pattern) || host === pattern.slice(1)) return true;
    } else if (host === pattern) {
      return true;
    }
  }
  return false;
}
