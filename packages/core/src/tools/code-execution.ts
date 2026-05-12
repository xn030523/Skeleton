/**
 * Code Execution Tool (PTC — Programmatic Tool Calling)
 *
 * Port of Hermes `tools/code_execution_tool.py` — simplified local-only version.
 *
 * Flow:
 *   1. LLM writes a Python script that wants to compose several tool calls.
 *   2. Parent (this module) generates `skeleton_tools.py` stub module with
 *      RPC stubs for the 7 sandbox-allowed tools.
 *   3. Parent opens a Unix domain socket (or loopback TCP on Windows) and
 *      spawns `python3 script.py` in a temp dir containing the stub.
 *   4. Script imports `skeleton_tools` → each stub call round-trips JSON over
 *      the socket to the parent, which dispatches to ToolRegistry.
 *   5. Only the script's stdout/stderr returns to the LLM; intermediate tool
 *      results never enter the context window.
 *
 * Remote sandbox backends (docker/ssh/modal/...) are NOT YET supported here;
 * Hermes falls back to file-based RPC for those, ported later under P2.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import net from "node:net";
import { spawn } from "node:child_process";
import type { ToolDef } from "../types.js";
import type { ToolRegistry } from "./registry.js";

// ── Config ───────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_SEC = 300;
const DEFAULT_MAX_TOOL_CALLS = 50;
const MAX_STDOUT_BYTES = 50_000;
const MAX_STDERR_BYTES = 10_000;

export const SANDBOX_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  "web_search",
  "web_fetch",
  "read_file",
  "write_file",
  "search_files",
  "edit_file",
  "patch_file",
  "terminal",
]);

// ── Env scrubbing ────────────────────────────────────────────────────

const SAFE_ENV_PREFIXES = [
  "PATH", "HOME", "USER", "LANG", "LC_", "TERM",
  "TMPDIR", "TMP", "TEMP", "SHELL", "LOGNAME",
  "XDG_", "PYTHONPATH", "VIRTUAL_ENV", "CONDA", "SKELETON_",
];

const SECRET_SUBSTRINGS = [
  "KEY", "TOKEN", "SECRET", "PASSWORD", "CREDENTIAL", "PASSWD", "AUTH",
];

const WINDOWS_ESSENTIAL_ENV = new Set([
  "SYSTEMROOT", "SYSTEMDRIVE", "WINDIR", "COMSPEC", "PATHEXT", "OS",
  "PROCESSOR_ARCHITECTURE", "NUMBER_OF_PROCESSORS",
  "PUBLIC", "ALLUSERSPROFILE", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)",
  "PROGRAMW6432", "APPDATA", "LOCALAPPDATA", "USERPROFILE", "USERDOMAIN",
  "USERNAME", "HOMEDRIVE", "HOMEPATH", "COMPUTERNAME",
]);

function scrubChildEnv(source: NodeJS.ProcessEnv): Record<string, string> {
  const isWindows = process.platform === "win32";
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(source)) {
    if (v === undefined) continue;
    const ku = k.toUpperCase();
    if (SECRET_SUBSTRINGS.some(s => ku.includes(s))) continue;
    if (SAFE_ENV_PREFIXES.some(p => k.startsWith(p))) { out[k] = v; continue; }
    if (isWindows && WINDOWS_ESSENTIAL_ENV.has(ku)) { out[k] = v; continue; }
  }
  return out;
}

// ── Stub module generator (Python) ───────────────────────────────────

interface StubTemplate {
  name: string;
  signature: string;
  doc: string;
  argsExpr: string;
}

const STUB_TEMPLATES: Record<string, StubTemplate> = {
  web_search: {
    name: "web_search",
    signature: "query: str, limit: int = 5",
    doc: '"""Search the web. Returns dict."""',
    argsExpr: '{"query": query, "limit": limit}',
  },
  web_fetch: {
    name: "web_fetch",
    signature: "url: str",
    doc: '"""Fetch a URL. Returns dict with content."""',
    argsExpr: '{"url": url}',
  },
  read_file: {
    name: "read_file",
    signature: "path: str, offset: int = 1, limit: int = 500",
    doc: '"""Read a file (1-indexed). Returns content string."""',
    argsExpr: '{"path": path, "offset": offset, "limit": limit}',
  },
  write_file: {
    name: "write_file",
    signature: "path: str, content: str",
    doc: '"""Write content to a file. Overwrites."""',
    argsExpr: '{"path": path, "content": content}',
  },
  search_files: {
    name: "search_files",
    signature: 'pattern: str, path: str = ".", file_glob: str = None, case_sensitive: bool = False, max_matches: int = 500',
    doc: '"""Recursive grep. Returns match summary."""',
    argsExpr: '{"pattern": pattern, "path": path, "file_glob": file_glob, "case_sensitive": case_sensitive, "max_matches": max_matches}',
  },
  edit_file: {
    name: "edit_file",
    signature: "path: str, old_string: str, new_string: str, replace_all: bool = False",
    doc: '"""Fuzzy find-and-replace."""',
    argsExpr: '{"path": path, "old_string": old_string, "new_string": new_string, "replace_all": replace_all}',
  },
  patch_file: {
    name: "patch_file",
    signature: "patch: str",
    doc: '"""Apply a V4A patch string."""',
    argsExpr: '{"patch": patch}',
  },
  terminal: {
    name: "terminal",
    signature: "command: str, timeout: int = None, cwd: str = None",
    doc: '"""Run a shell command (foreground)."""',
    argsExpr: '{"command": command, "timeout": timeout, "cwd": cwd}',
  },
};

const UDS_HEADER = `"""Auto-generated Skeleton tools RPC stubs."""
import json, os, socket, shlex, threading, time

_sock = None
_call_lock = threading.Lock()


def _connect():
    """Connect to parent RPC server via UDS or loopback TCP."""
    global _sock
    if _sock is None:
        endpoint = os.environ["SKELETON_RPC_SOCKET"]
        if endpoint.startswith("tcp://"):
            host_port = endpoint[len("tcp://"):]
            host, _, port = host_port.rpartition(":")
            _sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            _sock.connect((host or "127.0.0.1", int(port)))
        else:
            _sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            _sock.connect(endpoint)
        _sock.settimeout(300)
    return _sock


def _call(tool_name, args):
    """Send a tool call to the parent and return parsed result."""
    request = json.dumps({"tool": tool_name, "args": args}) + "\\n"
    with _call_lock:
        conn = _connect()
        conn.sendall(request.encode())
        buf = b""
        while True:
            chunk = conn.recv(65536)
            if not chunk:
                raise RuntimeError("Parent process disconnected")
            buf += chunk
            if buf.endswith(b"\\n"):
                break
    raw = buf.decode().strip()
    result = json.loads(raw)
    if isinstance(result, str):
        try:
            return json.loads(result)
        except (json.JSONDecodeError, TypeError):
            return result
    return result


def json_parse(text):
    """Parse JSON tolerant of control chars."""
    return json.loads(text, strict=False)


def shell_quote(s):
    """Shell-escape a string for safe interpolation."""
    return shlex.quote(s)


def retry(fn, max_attempts=3, delay=2):
    """Retry a function with exponential backoff."""
    last_err = None
    for attempt in range(max_attempts):
        try:
            return fn()
        except Exception as e:
            last_err = e
            if attempt < max_attempts - 1:
                time.sleep(delay * (2 ** attempt))
    raise last_err
`;

export function generateSkeletonToolsModule(enabledTools: string[]): string {
  const toolSet = new Set(enabledTools);
  const toGenerate = Array.from(SANDBOX_ALLOWED_TOOLS).filter(t => toolSet.has(t)).sort();

  const stubs: string[] = [];
  for (const name of toGenerate) {
    const tpl = STUB_TEMPLATES[name];
    if (!tpl) continue;
    stubs.push(
      `def ${tpl.name}(${tpl.signature}):\n` +
      `    ${tpl.doc}\n` +
      `    return _call(${JSON.stringify(tpl.name)}, ${tpl.argsExpr})\n`,
    );
  }

  return UDS_HEADER + "\n\n" + stubs.join("\n");
}

// ── RPC Server ───────────────────────────────────────────────────────

interface RpcServer {
  endpoint: string;
  close: () => void;
  callCount: () => number;
}

function startRpcServer(
  registry: ToolRegistry,
  opts: { maxCalls: number; tmpDir: string },
): Promise<RpcServer> {
  return new Promise((resolve, reject) => {
    const isWindows = process.platform === "win32";
    let callCount = 0;

    const server = net.createServer((conn) => {
      let buf = "";
      conn.on("data", async (chunk) => {
        buf += chunk.toString("utf-8");
        // Process complete newline-terminated requests.
        while (buf.includes("\n")) {
          const idx = buf.indexOf("\n");
          const line = buf.slice(0, idx);
          buf = buf.slice(idx + 1);
          if (!line.trim()) continue;

          callCount++;
          if (callCount > opts.maxCalls) {
            conn.write(JSON.stringify({ error: `Max tool calls (${opts.maxCalls}) exceeded` }) + "\n");
            continue;
          }

          try {
            const req = JSON.parse(line) as { tool: string; args: Record<string, unknown> };
            if (!SANDBOX_ALLOWED_TOOLS.has(req.tool)) {
              conn.write(JSON.stringify({ error: `Tool '${req.tool}' not allowed in sandbox` }) + "\n");
              continue;
            }
            const result = await registry.execute(req.tool, req.args ?? {});
            const payload = typeof result === "string" ? result : JSON.stringify(result ?? null);
            conn.write(payload + "\n");
          } catch (err) {
            conn.write(JSON.stringify({ error: (err as Error).message }) + "\n");
          }
        }
      });
      conn.on("error", () => { /* client disconnect — ignore */ });
    });

    server.on("error", reject);

    if (isWindows) {
      // Windows: loopback TCP on random port
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        if (typeof addr !== "object" || !addr) {
          reject(new Error("Failed to get TCP address"));
          return;
        }
        const endpoint = `tcp://127.0.0.1:${addr.port}`;
        resolve({
          endpoint,
          close: () => server.close(),
          callCount: () => callCount,
        });
      });
    } else {
      // POSIX: Unix domain socket in the script's temp dir
      const sockPath = path.join(opts.tmpDir, "skeleton_rpc.sock");
      server.listen(sockPath, () => {
        resolve({
          endpoint: sockPath,
          close: () => {
            server.close();
            try { fs.unlinkSync(sockPath); } catch { /* */ }
          },
          callCount: () => callCount,
        });
      });
    }
  });
}

// ── Python process runner ────────────────────────────────────────────

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  toolCallCount: number;
  truncated: { stdout: boolean; stderr: boolean };
}

async function runPythonWithRpc(
  script: string,
  registry: ToolRegistry,
  enabledTools: string[],
  timeoutSec: number,
  maxCalls: number,
): Promise<ExecResult> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "skeleton-exec-"));
  const scriptPath = path.join(tmpDir, "script.py");
  const stubPath = path.join(tmpDir, "skeleton_tools.py");

  fs.writeFileSync(stubPath, generateSkeletonToolsModule(enabledTools), "utf-8");
  fs.writeFileSync(scriptPath, script, "utf-8");

  const rpc = await startRpcServer(registry, { maxCalls, tmpDir });
  const childEnv = scrubChildEnv(process.env);
  childEnv.SKELETON_RPC_SOCKET = rpc.endpoint;
  childEnv.PYTHONPATH = tmpDir + (childEnv.PYTHONPATH ? path.delimiter + childEnv.PYTHONPATH : "");

  const pythonCmd = process.env.SKELETON_PYTHON || (process.platform === "win32" ? "python" : "python3");
  const started = Date.now();

  return await new Promise<ExecResult>((resolve) => {
    const proc = spawn(pythonCmd, [scriptPath], {
      cwd: tmpDir,
      env: childEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTrunc = false;
    let stderrTrunc = false;

    proc.stdout.on("data", (c: Buffer) => {
      if (stdoutBytes < MAX_STDOUT_BYTES) {
        const room = MAX_STDOUT_BYTES - stdoutBytes;
        if (c.length <= room) {
          stdoutChunks.push(c);
          stdoutBytes += c.length;
        } else {
          stdoutChunks.push(c.subarray(0, room));
          stdoutBytes = MAX_STDOUT_BYTES;
          stdoutTrunc = true;
        }
      } else {
        stdoutTrunc = true;
      }
    });
    proc.stderr.on("data", (c: Buffer) => {
      if (stderrBytes < MAX_STDERR_BYTES) {
        const room = MAX_STDERR_BYTES - stderrBytes;
        if (c.length <= room) {
          stderrChunks.push(c);
          stderrBytes += c.length;
        } else {
          stderrChunks.push(c.subarray(0, room));
          stderrBytes = MAX_STDERR_BYTES;
          stderrTrunc = true;
        }
      } else {
        stderrTrunc = true;
      }
    });

    const killTimer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* */ }
    }, timeoutSec * 1000);

    const cleanup = () => {
      clearTimeout(killTimer);
      rpc.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
    };

    proc.on("close", (code) => {
      cleanup();
      resolve({
        stdout: Buffer.concat(stdoutChunks).toString("utf-8"),
        stderr: Buffer.concat(stderrChunks).toString("utf-8"),
        exitCode: code ?? -1,
        durationMs: Date.now() - started,
        toolCallCount: rpc.callCount(),
        truncated: { stdout: stdoutTrunc, stderr: stderrTrunc },
      });
    });
    proc.on("error", (err) => {
      cleanup();
      resolve({
        stdout: "",
        stderr: `Failed to spawn python: ${err.message}`,
        exitCode: -1,
        durationMs: Date.now() - started,
        toolCallCount: 0,
        truncated: { stdout: false, stderr: false },
      });
    });
  });
}

// ── Tool definition ──────────────────────────────────────────────────

export interface CodeExecContext {
  registry: ToolRegistry;
  timeoutSec?: number;
  maxToolCalls?: number;
  /** Override which tools the script can call (must be ⊆ SANDBOX_ALLOWED_TOOLS). */
  enabledTools?: string[];
}

export function codeExecutionTool(ctx: CodeExecContext): ToolDef {
  return {
    name: "execute_code",
    description:
      "Run a Python script that composes multiple Skeleton tool calls. " +
      "The script can import `skeleton_tools` and call " +
      `${[...SANDBOX_ALLOWED_TOOLS].join(", ")}. ` +
      "Use this to chain several tools without consuming context per intermediate result — " +
      "only the script's stdout comes back. POSIX: UDS; Windows: loopback TCP. " +
      "Default timeout 5 min, max 50 tool calls per script.",
    parameters: {
      type: "object",
      properties: {
        script: {
          type: "string",
          description:
            "Python 3 script source. Must import `skeleton_tools` to call tools. " +
            "Example: `from skeleton_tools import read_file, terminal; " +
            "content = read_file('x.py')['content']; terminal(f'python -c ...')`.",
        },
        timeout_sec: {
          type: "integer",
          description: `Timeout in seconds (default ${DEFAULT_TIMEOUT_SEC}, max 900)`,
        },
      },
      required: ["script"],
    },
    execute: async (args) => {
      const script = String(args.script ?? "");
      if (!script.trim()) return { error: "script is required" };

      const timeout = Math.min(
        Number(args.timeout_sec ?? ctx.timeoutSec ?? DEFAULT_TIMEOUT_SEC),
        900,
      );
      const maxCalls = ctx.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;

      // Determine enabled tools: caller override → registry intersect.
      let enabled: string[];
      if (ctx.enabledTools) {
        enabled = ctx.enabledTools.filter(t => SANDBOX_ALLOWED_TOOLS.has(t));
      } else {
        const registered = new Set(ctx.registry.list().map(t => t.name));
        enabled = [...SANDBOX_ALLOWED_TOOLS].filter(t => registered.has(t));
      }

      const result = await runPythonWithRpc(script, ctx.registry, enabled, timeout, maxCalls);

      const lines: string[] = [];
      lines.push(`[execute_code] exit=${result.exitCode} duration=${result.durationMs}ms tool_calls=${result.toolCallCount}`);
      if (result.stdout) {
        lines.push(`\n--- stdout ---\n${result.stdout}${result.truncated.stdout ? "\n[stdout truncated]" : ""}`);
      }
      if (result.stderr) {
        lines.push(`\n--- stderr ---\n${result.stderr}${result.truncated.stderr ? "\n[stderr truncated]" : ""}`);
      }
      return lines.join("\n");
    },
    toolset: "code",
    emoji: "🐍",
  };
}
