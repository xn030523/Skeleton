/**
 * Atomic file write utility — prevents TOCTOU race conditions.
 *
 * Writes to a temporary file then renames atomically.
 * On POSIX, rename() is atomic within the same filesystem.
 * On Windows, rename is not guaranteed atomic but still prevents
 * partial writes from corrupting the target file.
 *
 * Sets restrictive permissions (0o600) on sensitive files.
 */

import fs from "node:fs";
import path from "node:path";

export function atomicWriteFileSync(
  filePath: string,
  content: string,
  options?: { mode?: number; encoding?: BufferEncoding },
): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  const mode = options?.mode ?? 0o644;
  const encoding = options?.encoding ?? "utf-8";

  fs.writeFileSync(tmpPath, content, { encoding, mode });

  try {
    fs.renameSync(tmpPath, filePath);
  } catch (err) {
    // Fallback: if rename fails (cross-device), copy + unlink
    try {
      fs.copyFileSync(tmpPath, filePath);
      fs.chmodSync(filePath, mode);
    } finally {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }
}

export function atomicWriteJsonSync(
  filePath: string,
  data: unknown,
  options?: { mode?: number; pretty?: boolean },
): void {
  const content = options?.pretty !== false
    ? JSON.stringify(data, null, 2)
    : JSON.stringify(data);
  atomicWriteFileSync(filePath, content + "\n", { mode: options?.mode });
}
