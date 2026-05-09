/**
 * Website Policy — user-managed website blocklist with optional shared list files.
 *
 * Loads blocklist entries from a config file and optional shared list URLs.
 * Results are cached with a short TTL to avoid redundant disk/network reads.
 */

import fs from "node:fs";
import path from "node:path";

interface BlocklistEntry {
  domain: string;
  reason: string;
}

interface CacheEntry {
  blocklist: BlocklistEntry[];
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000;
const blocklistCache = new Map<string, CacheEntry>();

let loadedBlocklist: BlocklistEntry[] = [];
let loadedAt = 0;

/** Check if a URL is allowed based on the loaded blocklist */
export function checkWebsiteAccess(url: string): { allowed: boolean; reason?: string } {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return { allowed: false, reason: "Invalid URL format" };
  }

  ensureBlocklistLoaded();

  for (const entry of loadedBlocklist) {
    const blocked = entry.domain.toLowerCase();
    if (hostname === blocked || hostname.endsWith(`.${blocked}`)) {
      return { allowed: false, reason: entry.reason };
    }
  }

  return { allowed: true };
}

/** Load blocklist from a config file (JSON or line-delimited text) and optional shared list URLs */
export function loadBlocklist(configPath?: string): void {
  const entries: BlocklistEntry[] = [];

  if (configPath && fs.existsSync(configPath)) {
    const raw = fs.readFileSync(configPath, "utf-8").trim();

    try {
      const parsed = JSON.parse(raw) as Array<{ domain: string; reason?: string }>;
      for (const item of parsed) {
        if (item.domain) {
          entries.push({ domain: item.domain, reason: item.reason ?? "Blocked by policy" });
        }
      }
    } catch {
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const sepIdx = trimmed.indexOf(" ");
        if (sepIdx > 0) {
          entries.push({ domain: trimmed.slice(0, sepIdx), reason: trimmed.slice(sepIdx + 1).trim() });
        } else {
          entries.push({ domain: trimmed, reason: "Blocked by policy" });
        }
      }
    }
  }

  const envBlocklist = process.env.SKELETON_BLOCKLIST_URLS ?? "";
  if (envBlocklist) {
    const urls = envBlocklist.split(",").map((u) => u.trim()).filter(Boolean);
    for (const listUrl of urls) {
      const cached = blocklistCache.get(listUrl);
      if (cached && Date.now() < cached.expiresAt) {
        entries.push(...cached.blocklist);
        continue;
      }

      try {
        const resp = fetch(listUrl, { signal: AbortSignal.timeout(5000) });
        resp.then((r) => {
          if (!r.ok) return;
          return r.text();
        }).then((text) => {
          if (!text) return;
          const urlEntries: BlocklistEntry[] = [];
          for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith("#")) continue;
            urlEntries.push({ domain: trimmed, reason: "Blocked by shared list" });
          }
          blocklistCache.set(listUrl, { blocklist: urlEntries, expiresAt: Date.now() + CACHE_TTL_MS });
        }).catch(() => {});
      } catch {
        // Fail-open on network errors
      }
    }
  }

  const envDomains = process.env.SKELETON_BLOCKED_DOMAINS ?? "";
  if (envDomains) {
    for (const domain of envDomains.split(",").map((d) => d.trim()).filter(Boolean)) {
      entries.push({ domain, reason: "Blocked by environment config" });
    }
  }

  loadedBlocklist = entries;
  loadedAt = Date.now();
}

function ensureBlocklistLoaded(): void {
  if (loadedBlocklist.length === 0 && Date.now() - loadedAt > CACHE_TTL_MS) {
    loadBlocklist();
  }
}
