/**
 * Vision analyzer — port of Hermes `tools/vision_tools.py`.
 *
 * Resolves the image (URL download / file:// / absolute path / data URI) into
 * a base64 data URI, then dispatches through AuxiliaryClient.analyzeImage()
 * which picks the correct multimodal request shape for the configured provider.
 *
 * Safety:
 *   - URL sources pass through check_website_access (url-safety)
 *   - Hard 50MB download cap (Hermes _VISION_MAX_DOWNLOAD_BYTES parity)
 *   - 30s HTTP timeout, overridable via SKELETON_VISION_DOWNLOAD_TIMEOUT
 *   - Cleans up any temp file on exit
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ToolDef } from "../types.js";
import type { LLMConfig } from "../types.js";
import { AuxiliaryClient } from "../auxiliary-client.js";
import { checkUrlSafety } from "./url-safety.js";

const DEFAULT_DOWNLOAD_TIMEOUT_MS = 30_000;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50 MB hard cap

let auxClient: AuxiliaryClient | null = null;

function resolveDownloadTimeoutMs(): number {
  const env = process.env.SKELETON_VISION_DOWNLOAD_TIMEOUT;
  if (env) {
    const n = Number(env);
    if (Number.isFinite(n) && n > 0) return n * 1000;
  }
  return DEFAULT_DOWNLOAD_TIMEOUT_MS;
}

function extToMime(ext: string): string {
  const e = ext.toLowerCase().replace(/^\./, "");
  switch (e) {
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "bmp": return "image/bmp";
    case "tiff":
    case "tif": return "image/tiff";
    case "svg": return "image/svg+xml";
    default: return "image/png";
  }
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

/** Load a local file path (with or without file:// prefix) into a data URI. */
function loadLocalFileAsDataUri(source: string): string {
  let fp: string;
  if (source.startsWith("file://")) {
    try {
      fp = fileURLToPath(source);
    } catch {
      fp = source.slice("file://".length);
    }
  } else {
    fp = source;
  }
  const resolved = path.resolve(fp);
  if (!fs.existsSync(resolved)) throw new Error(`Image not found: ${fp}`);
  const stat = fs.statSync(resolved);
  if (stat.size > MAX_DOWNLOAD_BYTES) {
    throw new Error(`Image too large: ${(stat.size / 1024 / 1024).toFixed(1)} MB > 50 MB cap`);
  }
  const buf = fs.readFileSync(resolved);
  const mime = extToMime(path.extname(resolved));
  return `data:${mime};base64,${buf.toString("base64")}`;
}

/**
 * Download URL → data URI. Streams with size cap, respects website-policy,
 * and enforces timeout.
 */
async function downloadAsDataUri(url: string): Promise<string> {
  // Safety check: website policy / URL safety
  const safety = checkUrlSafety(url);
  if (!safety.safe) {
    throw new Error(`URL blocked by safety policy: ${safety.reason ?? "blocked"}`);
  }

  const timeoutMs = resolveDownloadTimeoutMs();
  const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) throw new Error(`Failed to fetch image: HTTP ${resp.status}`);

  // Check Content-Length up-front if present
  const lengthHeader = resp.headers.get("content-length");
  if (lengthHeader) {
    const n = Number(lengthHeader);
    if (Number.isFinite(n) && n > MAX_DOWNLOAD_BYTES) {
      throw new Error(`Image too large: ${(n / 1024 / 1024).toFixed(1)} MB > 50 MB cap (Content-Length)`);
    }
  }

  // Stream with size cap
  const reader = resp.body?.getReader();
  if (!reader) {
    const ab = await resp.arrayBuffer();
    if (ab.byteLength > MAX_DOWNLOAD_BYTES) {
      throw new Error(`Image too large: ${(ab.byteLength / 1024 / 1024).toFixed(1)} MB > 50 MB cap`);
    }
    const contentType = resp.headers.get("content-type") ?? "image/png";
    return `data:${contentType};base64,${Buffer.from(ab).toString("base64")}`;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_DOWNLOAD_BYTES) {
      try { await reader.cancel(); } catch { /* */ }
      throw new Error(`Image too large: ${(total / 1024 / 1024).toFixed(1)} MB > 50 MB cap (streamed)`);
    }
    chunks.push(value);
  }

  const buf = Buffer.concat(chunks.map(c => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
  const contentType = resp.headers.get("content-type") ?? "image/png";
  return `data:${contentType};base64,${buf.toString("base64")}`;
}

/**
 * Resolve arbitrary image source (http URL / file path / file:// / data URI)
 * into a base64 data URI suitable for multimodal LLM requests.
 */
async function resolveImage(source: string): Promise<string> {
  if (!source?.trim()) throw new Error("image source is empty");

  if (source.startsWith("data:")) return source;
  if (isHttpUrl(source)) return await downloadAsDataUri(source);
  // file:// or bare path
  return loadLocalFileAsDataUri(source);
}

export function visionTool(): ToolDef {
  return {
    name: "vision_analyze",
    description:
      "Analyze an image with a custom question. Accepts http(s) URLs, " +
      "file:// URLs, absolute file paths, or data: URIs. Image is downloaded " +
      "(≤ 50 MB, 30s timeout) and dispatched to the auxiliary vision provider " +
      "using provider-native multimodal format. Configure via config.auxiliary.vision.",
    parameters: {
      type: "object",
      properties: {
        image_url: {
          type: "string",
          description:
            "Image source: http(s) URL, file:// URL, absolute file path, or data URI.",
        },
        question: {
          type: "string",
          description: "What to ask about the image.",
        },
      },
      required: ["image_url", "question"],
    },
    execute: async (args) => {
      const imageSource = String(args.image_url ?? "").trim();
      const question = String(args.question ?? "").trim();
      if (!imageSource) return { error: "image_url is required" };
      if (!question) return { error: "question is required" };

      let dataUri: string;
      try {
        dataUri = await resolveImage(imageSource);
      } catch (err) {
        return { error: `Failed to load image: ${(err as Error).message}` };
      }

      const client = getAuxClient();
      try {
        const analysis = await client.analyzeImage(dataUri, question);
        return {
          image_url: imageSource,
          question,
          analysis,
        };
      } catch (err) {
        return { error: `Vision analysis failed: ${(err as Error).message}` };
      }
    },
    toolset: "vision",
    emoji: "👁️",
  };
}

/** Called by the Agent at construction time to inject the real aux client. */
export function setAuxClientForVision(client: AuxiliaryClient): void {
  auxClient = client;
}

function getAuxClient(): AuxiliaryClient {
  if (auxClient) return auxClient;
  // Fallback only if nothing was injected (e.g. tool used in isolation).
  const fallback: LLMConfig = {
    protocol: (process.env.SKELETON_AUX_PROTOCOL as LLMConfig["protocol"]) ?? "openai",
    apiKey: process.env.SKELETON_AUX_API_KEY ?? process.env.SKELETON_API_KEY ?? "",
    baseUrl: process.env.SKELETON_AUX_BASE_URL ?? "https://api.openai.com/v1",
    model: process.env.SKELETON_AUX_MODEL ?? "gpt-4o",
    maxTokens: 1024,
    temperature: 0.3,
  };
  auxClient = new AuxiliaryClient(fallback);
  return auxClient;
}
