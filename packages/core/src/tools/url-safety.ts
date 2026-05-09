/**
 * URL Safety — SSRF prevention by blocking private/internal network addresses.
 *
 * Always blocks cloud metadata endpoints (169.254.169.254).
 * Blocks private IP ranges (10.x, 172.16-31.x, 192.168.x, 127.x).
 * Configurable allowPrivateUrls toggle for local development.
 *
 * Inspired by Hermes url_safety.py.
 */

const BLOCKED_HOSTNAMES = new Set([
  "localhost", "localhost.localdomain",
  "metadata.google.internal", "metadata.goog",
]);

const ALWAYS_BLOCKED_IPS = [
  "169.254.169.254",  // AWS/GCP/Azure metadata
  "169.254.170.2",    // AWS ECS task metadata
  "100.100.100.200",  // Alibaba Cloud metadata
];

const PRIVATE_IP_RANGES: Array<{ start: number; end: number }> = [
  { start: ipToNum("10.0.0.0"), end: ipToNum("10.255.255.255") },
  { start: ipToNum("172.16.0.0"), end: ipToNum("172.31.255.255") },
  { start: ipToNum("192.168.0.0"), end: ipToNum("192.168.255.255") },
  { start: ipToNum("127.0.0.0"), end: ipToNum("127.255.255.255") },
  { start: ipToNum("0.0.0.0"), end: ipToNum("0.255.255.255") },
  { start: ipToNum("169.254.0.0"), end: ipToNum("169.254.255.255") },
];

function ipToNum(ip: string): number {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isPrivateIP(ip: string): boolean {
  const num = ipToNum(ip);
  return PRIVATE_IP_RANGES.some(r => num >= r.start && num <= r.end);
}

export interface UrlSafetyResult {
  safe: boolean;
  reason?: string;
}

/** Check if a URL is safe to access (SSRF prevention) */
export function checkUrlSafety(
  urlStr: string,
  options?: { allowPrivate?: boolean },
): UrlSafetyResult {
  const allowPrivate = options?.allowPrivate ?? false;

  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return { safe: false, reason: "Invalid URL format" };
  }

  const protocol = url.protocol;
  if (protocol !== "http:" && protocol !== "https:") {
    return { safe: false, reason: `Blocked protocol: ${protocol}` };
  }

  const hostname = url.hostname.toLowerCase();

  // Block known dangerous hostnames
  if (BLOCKED_HOSTNAMES.has(hostname) && !allowPrivate) {
    return { safe: false, reason: `Blocked hostname: ${hostname}` };
  }

  // Always block cloud metadata IPs (no override)
  if (ALWAYS_BLOCKED_IPS.includes(hostname)) {
    return { safe: false, reason: `Blocked cloud metadata endpoint: ${hostname}` };
  }

  // Check private IP ranges
  if (!allowPrivate && isPrivateIP(hostname)) {
    return { safe: false, reason: `Blocked private/internal IP: ${hostname}` };
  }

  // Block hostname patterns
  if (!allowPrivate) {
    if (hostname.endsWith(".internal") || hostname.endsWith(".local") || hostname.endsWith(".localhost")) {
      return { safe: false, reason: `Blocked internal hostname: ${hostname}` };
    }
    if (/^0\./.test(hostname)) {
      return { safe: false, reason: `Blocked broadcast address: ${hostname}` };
    }
  }

  return { safe: true };
}
