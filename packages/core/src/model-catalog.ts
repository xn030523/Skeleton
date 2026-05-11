/**
 * Remote model catalog manifest — pull model lists from a remote JSON
 * so new models can appear without a Skeleton release.
 *
 * Format:
 *   {
 *     "version": "2026-05-09",
 *     "providers": {
 *       "openai": { "models": ["gpt-5", "gpt-5-mini", ...] },
 *       "anthropic": { "models": ["claude-sonnet-5", ...] }
 *     }
 *   }
 *
 * URL source:
 *   1. SKELETON_MODEL_CATALOG_URL env
 *   2. Default: disabled (empty string)
 *   3. default: https://raw.githubusercontent.com/your-org/skeleton/main/model-catalog.json
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const CACHE_PATH = path.join(os.homedir(), ".skeleton", "model-catalog.json");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Default disabled — users must set SKELETON_MODEL_CATALOG_URL or config.modelCatalog.url
// to their own hosted manifest JSON. Prevents 404 spam on uninstalled default.
const DEFAULT_URL = "";

export interface ModelCatalog {
  version: string;
  providers: Record<string, { models: string[]; defaultModel?: string; pricing?: Record<string, { input: number; output: number }> }>;
  fetchedAt?: string;
}

/** Fetch manifest from remote URL (with caching). Returns null if no URL configured. */
export async function fetchModelCatalog(url?: string, forceRefresh = false): Promise<ModelCatalog | null> {
  const source = url ?? process.env.SKELETON_MODEL_CATALOG_URL ?? DEFAULT_URL;
  if (!source) {
    // No catalog URL configured — return cached if any, else null (no spam)
    return loadCached();
  }

  if (!forceRefresh) {
    const cached = loadCached();
    if (cached && isFresh(cached)) return cached;
  }

  try {
    const resp = await fetch(source, {
      signal: AbortSignal.timeout(10_000),
      headers: { "Accept": "application/json" },
    });
    if (!resp.ok) {
      const cached = loadCached();
      return cached ?? null;
    }
    const data = await resp.json() as ModelCatalog;
    data.fetchedAt = new Date().toISOString();
    saveCached(data);
    return data;
  } catch {
    return loadCached();
  }
}

/** Get models for a specific provider from catalog */
export async function getModelsForProvider(provider: string): Promise<string[]> {
  const catalog = await fetchModelCatalog();
  return catalog?.providers[provider]?.models ?? [];
}

/** Load cached catalog from disk */
function loadCached(): ModelCatalog | null {
  try {
    if (fs.existsSync(CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(CACHE_PATH, "utf-8")) as ModelCatalog;
    }
  } catch { /* ignore */ }
  return null;
}

/** Check if cached catalog is still fresh */
function isFresh(catalog: ModelCatalog): boolean {
  if (!catalog.fetchedAt) return false;
  const age = Date.now() - new Date(catalog.fetchedAt).getTime();
  return age < CACHE_TTL_MS;
}

/** Save catalog to cache */
function saveCached(catalog: ModelCatalog): void {
  try {
    fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
    fs.writeFileSync(CACHE_PATH, JSON.stringify(catalog, null, 2), "utf-8");
  } catch { /* non-critical */ }
}

/** Invalidate cached catalog (force next fetch to go remote) */
export function invalidateCatalog(): void {
  try { if (fs.existsSync(CACHE_PATH)) fs.unlinkSync(CACHE_PATH); } catch { /* ignore */ }
}
