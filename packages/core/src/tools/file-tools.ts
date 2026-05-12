/**
 * File tools exposed to the LLM — read / write / edit / patch / search.
 *
 * All backed by LocalFileOperations + V4A patch parser + 9-strategy fuzzy
 * match. Each tool records read/write state via file-state registry so
 * concurrent sub-agents coordinate correctly.
 */

import type { ToolDef } from "../types.js";
import { LocalFileOperations, type FileOpsContext } from "./file-operations.js";
import { parseV4APatch, applyV4AOperations } from "./patch-parser.js";

const DEFAULT_TASK_ID = "main";

function getFileOps(ctx: FileOpsContext | undefined): LocalFileOperations {
  return new LocalFileOperations(ctx ?? { taskId: DEFAULT_TASK_ID });
}

export function readFileTool(ctx?: FileOpsContext): ToolDef {
  return {
    name: "read_file",
    description:
      "Read a file with line-number prefixes and pagination. Use offset/limit " +
      "for large files. Returns file contents, total line count, truncation status.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file" },
        offset: { type: "integer", description: "Starting line (1-based, default 1)" },
        limit: { type: "integer", description: "Max lines to return (default 500)" },
      },
      required: ["path"],
    },
    execute: async (args) => {
      const ops = getFileOps(ctx);
      const r = ops.readFile(
        String(args.path),
        Number(args.offset ?? 1),
        Number(args.limit ?? 500),
      );
      if (r.error) return `Error: ${r.error}${r.similarFiles.length > 0 ? `\nDid you mean:\n${r.similarFiles.map(p => "  " + p).join("\n")}` : ""}`;
      const hint = r.hint ? `\n(${r.hint})` : "";
      return `${r.content}\n\n[${r.totalLines} lines, ${r.fileSize} bytes${r.truncated ? ", truncated" : ""}]${hint}`;
    },
    toolset: "file",
    emoji: "📖",
  };
}

export function writeFileTool(ctx?: FileOpsContext): ToolDef {
  return {
    name: "write_file",
    description:
      "Write content to a file. Creates parent directories if missing. " +
      "Warns (but does not refuse) if the file was not read first or has " +
      "been modified since last read by a sibling sub-agent.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to the file" },
        content: { type: "string", description: "Full file content" },
      },
      required: ["path", "content"],
    },
    execute: async (args) => {
      const ops = getFileOps(ctx);
      const r = ops.writeFile(String(args.path), String(args.content ?? ""));
      if (r.error) return `Error: ${r.error}`;
      const parts = [`Wrote ${r.bytesWritten} bytes to ${args.path}`];
      if (r.dirsCreated) parts.push("(created parent directories)");
      if (r.warning) parts.push(`\nWarning: ${r.warning}`);
      return parts.join(" ");
    },
    toolset: "file",
    emoji: "✍️",
  };
}

export function editFileTool(ctx?: FileOpsContext): ToolDef {
  return {
    name: "edit_file",
    description:
      "Find-and-replace edit with 9-strategy fuzzy match (whitespace / " +
      "unicode / escape tolerant). By default requires old_string to be " +
      "unique in the file; set replace_all=true to replace every occurrence.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        old_string: { type: "string", description: "Text to find" },
        new_string: { type: "string", description: "Replacement text" },
        replace_all: { type: "boolean", description: "Replace all occurrences (default false)" },
      },
      required: ["path", "old_string", "new_string"],
    },
    execute: async (args) => {
      const ops = getFileOps(ctx);
      const r = ops.editFile(
        String(args.path),
        String(args.old_string ?? ""),
        String(args.new_string ?? ""),
        Boolean(args.replace_all),
      );
      if (r.error) return `Error: ${r.error}`;
      return `Edited ${args.path}: replaced ${r.matchCount} occurrence(s) (strategy=${r.strategy})`;
    },
    toolset: "file",
    emoji: "✏️",
  };
}

export function patchFileTool(ctx?: FileOpsContext): ToolDef {
  return {
    name: "patch_file",
    description:
      "Apply a V4A-format patch to one or more files. Supports Update / Add / " +
      "Delete / Move operations across multiple files in one call. Validates " +
      "all hunks before writing; if any hunk fails, no files are modified.",
    parameters: {
      type: "object",
      properties: {
        patch: {
          type: "string",
          description:
            "V4A patch text. Format:\n" +
            "*** Begin Patch\n*** Update File: path/to/file.py\n@@ hint @@\n" +
            " context\n-removed\n+added\n*** Add File: new.py\n+content\n" +
            "*** Delete File: old.py\n*** Move File: a.py -> b.py\n*** End Patch",
        },
      },
      required: ["patch"],
    },
    execute: async (args) => {
      const ops = getFileOps(ctx);
      const { operations, error: parseErr } = parseV4APatch(String(args.patch ?? ""));
      if (parseErr) return `Parse error: ${parseErr}`;
      if (operations.length === 0) return "Empty patch — no operations found";

      const result = applyV4AOperations(operations, {
        readFileRaw: (p) => {
          const r = ops.readFileRaw(p);
          return { content: r.content, error: r.error };
        },
        writeFile: (p, c) => ({ error: ops.writeFile(p, c).error }),
        deleteFile: (p) => ops.deleteFile(p),
        moveFile: (f, t) => ops.moveFile(f, t),
      });

      if (!result.success) return result.error ?? "Patch failed";
      const summary = [
        `Patch applied successfully.`,
        result.filesModified && result.filesModified.length > 0
          ? `  Modified: ${result.filesModified.join(", ")}` : "",
        result.filesCreated && result.filesCreated.length > 0
          ? `  Created: ${result.filesCreated.join(", ")}` : "",
        result.filesDeleted && result.filesDeleted.length > 0
          ? `  Deleted: ${result.filesDeleted.join(", ")}` : "",
      ].filter(Boolean).join("\n");
      return summary;
    },
    toolset: "file",
    emoji: "🩹",
  };
}

export function searchFilesTool(ctx?: FileOpsContext): ToolDef {
  return {
    name: "search_files",
    description:
      "Recursively search files for a regex pattern. Returns file paths, " +
      "line numbers, and matched content. Skips hidden / node_modules / dist / " +
      "__pycache__ and binary extensions. Set file_glob like '*.ts' to filter.",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex pattern" },
        path: { type: "string", description: "Directory to search (default '.')" },
        file_glob: { type: "string", description: "Filename glob filter, e.g. '*.py'" },
        case_sensitive: { type: "boolean", description: "Case-sensitive match (default false)" },
        max_matches: { type: "integer", description: "Max matches to return (default 500)" },
      },
      required: ["pattern"],
    },
    execute: async (args) => {
      const ops = getFileOps(ctx);
      const r = ops.search(
        String(args.pattern),
        String(args.path ?? "."),
        {
          fileGlob: args.file_glob ? String(args.file_glob) : undefined,
          caseSensitive: Boolean(args.case_sensitive),
          maxMatches: args.max_matches ? Number(args.max_matches) : undefined,
        },
      );
      if (r.error) return `Error: ${r.error}`;
      if (r.totalCount === 0) return "No matches.";
      const lines = [
        `Found ${r.totalCount} match(es) in ${r.files.length} file(s)${r.truncated ? " (truncated)" : ""}:`,
        ...r.matches.slice(0, 100).map(m => `  ${m.path}:${m.lineNumber}: ${m.content}`),
      ];
      if (r.matches.length > 100) lines.push(`  … ${r.matches.length - 100} more matches`);
      return lines.join("\n");
    },
    toolset: "file",
    emoji: "🔍",
  };
}

/** Build all 5 file tools with shared context (taskId for state guard). */
export function buildFileTools(ctx?: FileOpsContext): ToolDef[] {
  return [
    readFileTool(ctx),
    writeFileTool(ctx),
    editFileTool(ctx),
    patchFileTool(ctx),
    searchFilesTool(ctx),
  ];
}
