import fs from "node:fs";
import path from "node:path";

export type PatchOperationType = "add" | "update" | "delete" | "move";

export interface AddOperation {
  type: "add";
  path: string;
  content: string;
}

export interface UpdateOperation {
  type: "update";
  path: string;
  findText: string;
  replaceText: string;
}

export interface DeleteOperation {
  type: "delete";
  path: string;
}

export interface MoveOperation {
  type: "move";
  oldPath: string;
  newPath: string;
}

export type PatchOperation = AddOperation | UpdateOperation | DeleteOperation | MoveOperation;

export interface ApplyResult {
  applied: number;
  failed: number;
  errors: Array<{ path: string; error: string }>;
}

const ADD_RE = /^\*\*\*\s*Add:\s*(.+)$/;
const UPDATE_RE = /^\*\*\*\s*Update:\s*(.+)$/;
const DELETE_RE = /^\*\*\*\s*Delete:\s*(.+)$/;
const MOVE_RE = /^\*\*\*\s*Move:\s*(.+?)\s*>>>\s*(.+)$/;
const SEPARATOR_RE = /^>>>$/;

export function parseV4APatch(patch: string): PatchOperation[] {
  const lines = patch.split("\n");
  const ops: PatchOperation[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    let m: RegExpMatchArray | null;

    m = line.match(MOVE_RE);
    if (m) {
      ops.push({ type: "move", oldPath: m[1].trim(), newPath: m[2].trim() });
      i++;
      continue;
    }

    m = line.match(DELETE_RE);
    if (m) {
      ops.push({ type: "delete", path: m[1].trim() });
      i++;
      continue;
    }

    m = line.match(ADD_RE);
    if (m) {
      const filePath = m[1].trim();
      i++;
      const contentLines: string[] = [];
      while (i < lines.length && !lines[i].match(/^\*\*\*\s*(Add|Update|Delete|Move)/)) {
        contentLines.push(lines[i]);
        i++;
      }
      const content = contentLines.join("\n").replace(/\n$/, "");
      ops.push({ type: "add", path: filePath, content });
      continue;
    }

    m = line.match(UPDATE_RE);
    if (m) {
      const filePath = m[1].trim();
      i++;
      const findLines: string[] = [];
      while (i < lines.length && !SEPARATOR_RE.test(lines[i]) && !lines[i].match(/^\*\*\*\s*(Add|Update|Delete|Move)/)) {
        findLines.push(lines[i]);
        i++;
      }
      if (i < lines.length && SEPARATOR_RE.test(lines[i])) {
        i++;
      }
      const replaceLines: string[] = [];
      while (i < lines.length && !lines[i].match(/^\*\*\*\s*(Add|Update|Delete|Move)/)) {
        replaceLines.push(lines[i]);
        i++;
      }
      ops.push({
        type: "update",
        path: filePath,
        findText: findLines.join("\n"),
        replaceText: replaceLines.join("\n"),
      });
      continue;
    }

    i++;
  }

  return ops;
}

export async function applyV4AOperations(ops: PatchOperation[], cwd: string): Promise<ApplyResult> {
  let applied = 0;
  let failed = 0;
  const errors: Array<{ path: string; error: string }> = [];

  for (const op of ops) {
    try {
      switch (op.type) {
        case "add": {
          const absPath = path.resolve(cwd, op.path);
          const dir = path.dirname(absPath);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(absPath, op.content, "utf-8");
          applied++;
          break;
        }
        case "update": {
          const absPath = path.resolve(cwd, op.path);
          if (!fs.existsSync(absPath)) {
            errors.push({ path: op.path, error: "File not found" });
            failed++;
            break;
          }
          const existing = fs.readFileSync(absPath, "utf-8");
          const { fuzzyFindAndReplace } = await import("./fuzzy-match.js");
          const result = fuzzyFindAndReplace(existing, op.findText, op.replaceText);
          if (!result.success) {
            errors.push({ path: op.path, error: `Could not find match for update (tried ${result.strategy ?? "no"} strategy)` });
            failed++;
            break;
          }
          fs.writeFileSync(absPath, result.result, "utf-8");
          applied++;
          break;
        }
        case "delete": {
          const absPath = path.resolve(cwd, op.path);
          if (!fs.existsSync(absPath)) {
            errors.push({ path: op.path, error: "File not found" });
            failed++;
            break;
          }
          fs.unlinkSync(absPath);
          applied++;
          break;
        }
        case "move": {
          const oldAbsPath = path.resolve(cwd, op.oldPath);
          const newAbsPath = path.resolve(cwd, op.newPath);
          if (!fs.existsSync(oldAbsPath)) {
            errors.push({ path: op.oldPath, error: "Source file not found" });
            failed++;
            break;
          }
          const newDir = path.dirname(newAbsPath);
          fs.mkdirSync(newDir, { recursive: true });
          fs.renameSync(oldAbsPath, newAbsPath);
          applied++;
          break;
        }
      }
    } catch (err) {
      errors.push({ path: "path" in op ? op.path : op.oldPath, error: (err as Error).message });
      failed++;
    }
  }

  return { applied, failed, errors };
}
