/**
 * ACP auth helpers — detect the currently configured Skeleton provider.
 *
 * Aligned with Hermes acp_adapter/auth.py.
 */

import { loadConfig } from "../config/index.js";
import { findProvider } from "../providers/registry.js";

export function detectProvider(): string | null {
  try {
    const config = loadConfig();
    const providerName = (config.llm as any).provider as string | undefined;
    if (!providerName) return null;
    const provider = findProvider(providerName);
    if (!provider) return null;
    const apiKey = (config.llm as any).apiKey as string | undefined;
    if (!apiKey) return null;
    return providerName.toLowerCase();
  } catch {
    return null;
  }
}

export function hasProvider(): boolean {
  return detectProvider() !== null;
}
