/**
 * Binary file extensions — skip for text-based operations.
 *
 * These files can't be meaningfully diffed/edited as text.
 * Port of Hermes `tools/binary_extensions.py` (ultimately from free-code).
 * Note: .pdf is intentionally EXCLUDED — it's text-extractable and agents
 * may want to inspect PDFs during reverse engineering / forensics tasks.
 */

export const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  // Images
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".tiff", ".tif",
  // Videos
  ".mp4", ".mov", ".avi", ".mkv", ".webm", ".wmv", ".flv", ".m4v", ".mpeg", ".mpg",
  // Audio
  ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a", ".wma", ".aiff", ".opus",
  // Archives
  ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar", ".xz", ".z", ".tgz", ".iso",
  // Executables / binaries
  ".exe", ".dll", ".so", ".dylib", ".bin", ".o", ".a", ".obj", ".lib",
  ".app", ".msi", ".deb", ".rpm",
  // Office docs (pdf excluded — text-extractable)
  ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  ".odt", ".ods", ".odp",
  // Fonts
  ".ttf", ".otf", ".woff", ".woff2", ".eot",
  // Bytecode / VM artifacts
  ".pyc", ".pyo", ".class", ".jar", ".war", ".ear", ".node", ".wasm", ".rlib",
  // Databases
  ".sqlite", ".sqlite3", ".db", ".mdb", ".idx",
  // Design / 3D
  ".psd", ".ai", ".eps", ".sketch", ".fig", ".xd", ".blend", ".3ds", ".max",
  // Flash
  ".swf", ".fla",
  // Lock / profiling data
  ".lockb", ".dat", ".data",
]);

/** Pure string check — no filesystem I/O. */
export function hasBinaryExtension(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return false;
  return BINARY_EXTENSIONS.has(path.slice(dot).toLowerCase());
}
