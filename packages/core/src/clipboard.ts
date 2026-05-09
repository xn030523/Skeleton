/**
 * Clipboard integration — cross-platform system clipboard read/write.
 *
 * /copy — write last assistant output to clipboard
 * /paste — read clipboard content and submit as input
 */

import { execSync } from "node:child_process";
import process from "node:process";

/** Detect platform clipboard command */
function detectClipboard(): { copy: (text: string) => void; paste: () => string } | null {
  const isWin = process.platform === "win32";
  const isMac = process.platform === "darwin";

  if (isWin) {
    return {
      copy: (text) => {
        // Use clip.exe on Windows
        const proc = Bun.spawnSync?.("clip", { stdin: text }) ??
          execSync("clip", { input: text, encoding: "utf-8" });
      },
      paste: () => {
        try {
          return execSync("powershell -command Get-Clipboard", { encoding: "utf-8" }).trim();
        } catch {
          return "";
        }
      },
    };
  }

  if (isMac) {
    return {
      copy: (text) => { execSync("pbcopy", { input: text, encoding: "utf-8" }); },
      paste: () => { return execSync("pbpaste", { encoding: "utf-8" }).trim(); },
    };
  }

  // Linux — try xclip, then xsel, then wl-copy
  try {
    execSync("which xclip", { encoding: "utf-8" });
    return {
      copy: (text) => { execSync("xclip -selection clipboard", { input: text, encoding: "utf-8" }); },
      paste: () => { return execSync("xclip -selection clipboard -o", { encoding: "utf-8" }).trim(); },
    };
  } catch { /* xclip not found */ }

  try {
    execSync("which xsel", { encoding: "utf-8" });
    return {
      copy: (text) => { execSync("xsel --clipboard --input", { input: text, encoding: "utf-8" }); },
      paste: () => { return execSync("xsel --clipboard --output", { encoding: "utf-8" }).trim(); },
    };
  } catch { /* xsel not found */ }

  try {
    execSync("which wl-copy", { encoding: "utf-8" });
    return {
      copy: (text) => { execSync("wl-copy", { input: text, encoding: "utf-8" }); },
      paste: () => { return execSync("wl-paste", { encoding: "utf-8" }).trim(); },
    };
  } catch { /* wayland not found */ }

  return null;
}

let _clipboard: ReturnType<typeof detectClipboard> | undefined;

function getClipboard() {
  if (_clipboard === undefined) {
    _clipboard = detectClipboard();
  }
  return _clipboard;
}

/** Copy text to system clipboard. Returns true on success. */
export function copyToClipboard(text: string): boolean {
  try {
    const cb = getClipboard();
    if (!cb) return false;
    cb.copy(text);
    return true;
  } catch {
    return false;
  }
}

/** Read text from system clipboard. Returns empty string on failure. */
export function pasteFromClipboard(): string {
  try {
    const cb = getClipboard();
    if (!cb) return "";
    return cb.paste();
  } catch {
    return "";
  }
}

/** Check if clipboard commands are available */
export function isClipboardAvailable(): boolean {
  return getClipboard() !== null;
}
