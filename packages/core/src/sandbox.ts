/**
 * Sandbox execution backends — run commands in isolated environments.
 *
 * Backends:
 * - local: direct execution with env blocklist (credential stripping) + CWD persistence
 * - docker: persistent container + docker exec + security hardening + bind mounts
 * - ssh: ControlMaster connection reuse + BatchMode
 *
 * Inspired by Hermes tools/environments/ (docker.py, local.py, ssh.py).
 */

import { exec, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { ToolDef } from "../types.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type SandboxBackend = "local" | "docker" | "ssh";

export interface SandboxConfig {
  backend: SandboxBackend;
  dockerImage?: string;
  dockerCwd?: string;
  sshHost?: string;
  sshUser?: string;
  sshPort?: number;
  sshKey?: string;
  sshCwd?: string;
  defaultTimeout?: number;
}

export interface DockerSandboxOptions {
  image?: string;
  cwd?: string;
  persistent?: boolean;
  network?: boolean;
  volumes?: string[];
  forwardEnv?: string[];
  cpuLimit?: number;
  memoryLimit?: string;
}

export interface SandboxExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

const DEFAULT_TIMEOUT = 30000;

// ── Utility ──────────────────────────────────────────────────────────────────

function shellEscape(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

function detectBackend(): SandboxBackend {
  const env = process.env.SKELETON_SANDBOX ?? "local";
  if (env === "docker") return "docker";
  if (env === "ssh") return "ssh";
  return "local";
}

function getDockerBinary(): string {
  return process.env.SKELETON_DOCKER_BINARY ?? "docker";
}

function getDockerImage(): string {
  return process.env.SKELETON_DOCKER_IMAGE ?? "ubuntu:22.04";
}

function getSkeletonDir(): string {
  const dir = join(homedir(), ".skeleton");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

/** Generate a short deterministic hash for SSH ControlMaster socket paths */
function controlPath(user: string, host: string, port: number): string {
  const key = `${user}@${host}:${port}`;
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
  const sshDir = join(getSkeletonDir(), "ssh");
  if (!existsSync(sshDir)) mkdirSync(sshDir, { recursive: true });
  return join(sshDir, `cm-${hash}`);
}

// ── Env Blocklist (aligned with Hermes _HERMES_PROVIDER_ENV_BLOCKLIST) ──────

const ENV_BLOCKLIST = new Set([
  // OpenAI
  "OPENAI_API_KEY", "OPENAI_ORG_ID", "OPENAI_PROJECT_ID", "OPENAI_API_BASE",
  // Anthropic
  "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN",
  // Google
  "GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_ACCESS_TOKEN", "GOOGLE_REFRESH_TOKEN",
  // DeepSeek
  "DEEPSEEK_API_KEY",
  // Mistral
  "MISTRAL_API_KEY", "MISTRAL_ORGANIZATION_ID",
  // Groq
  "GROQ_API_KEY",
  // Together
  "TOGETHER_API_KEY",
  // Skeleton-specific
  "SKELETON_BRAVE_API_KEY", "SKELETON_EXA_API_KEY", "SKELETON_TAVILY_API_KEY",
  "SKELETON_FIRECRAWL_API_KEY", "SKELETON_SEARXNG_URL",
  // Cloud provider tokens
  "DAYTONA_API_KEY", "MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET", "VERCEL_TOKEN",
  "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN",
  "AZURE_API_KEY",
  // Messaging (prevent credential leak)
  "TELEGRAM_BOT_TOKEN", "DISCORD_BOT_TOKEN", "SLACK_BOT_TOKEN",
  "SLACK_APP_TOKEN", "DISCORD_APPLICATION_ID",
  // GitHub
  "GITHUB_TOKEN", "GH_TOKEN",
]);

const ENV_FORCE_PREFIX = "SKELETON_FORCE_";

function buildSubprocessEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined) continue;
    if (ENV_BLOCKLIST.has(k)) continue;
    // Skip FORCE_ prefix vars (handled below)
    if (k.startsWith(ENV_FORCE_PREFIX)) continue;
    env[k] = v;
  }
  // FORCE_ prefix passthrough: SKELETON_FORCE_MY_VAR=xxx → MY_VAR=xxx
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith(ENV_FORCE_PREFIX) && v !== undefined) {
      env[k.slice(ENV_FORCE_PREFIX.length)] = v;
    }
  }
  return { ...env, ...extra };
}

// ── CWD Persistence ─────────────────────────────────────────────────────────

let currentCwd: string | undefined;

function getEffectiveCwd(configCwd?: string): string | undefined {
  return configCwd ?? currentCwd ?? process.cwd();
}

function updateCwdFromOutput(stderr: string): void {
  // Parse CWD marker if present
  const marker = "__SKELETON_CWD__";
  const idx = stderr.indexOf(marker);
  if (idx >= 0) {
    const after = stderr.slice(idx + marker.length).trim();
    const lines = after.split("\n");
    const cwd = lines[0]?.trim();
    if (cwd && existsSync(cwd)) {
      currentCwd = cwd;
    }
  }
}

function stripCwdMarker(output: string): string {
  return output.replace(/\n?__SKELETON_CWD__\n?/g, "\n").trim();
}

// ── Docker Sandbox ──────────────────────────────────────────────────────────

export class DockerSandbox {
  private containerId: string | null = null;
  private containerName: string;
  private dockerExe: string;
  private _running = false;

  constructor(
    private image: string = getDockerImage(),
    private options: DockerSandboxOptions = {},
  ) {
    this.dockerExe = getDockerBinary();
    const id = Math.random().toString(36).slice(2, 10);
    this.containerName = `skeleton-${id}`;
  }

  async start(): Promise<string> {
    if (this.containerId && this._running) return this.containerId;

    const args: string[] = ["run", "-d"];
    args.push("--name", this.containerName);
    args.push("--init");

    // Security hardening (aligned with Hermes)
    args.push("--cap-drop", "ALL");
    args.push("--cap-add", "DAC_OVERRIDE");
    args.push("--cap-add", "CHOWN");
    args.push("--cap-add", "FOWNER");
    args.push("--security-opt", "no-new-privileges");
    args.push("--pids-limit", "256");
    args.push("--tmpfs", "/tmp:rw,nosuid,size=512m");
    args.push("--tmpfs", "/run:rw,noexec,nosuid,size=64m");

    // Network
    if (this.options.network === false) {
      args.push("--network=none");
    }

    // Resource limits
    if (this.options.cpuLimit) {
      args.push("--cpus", String(this.options.cpuLimit));
    }
    if (this.options.memoryLimit) {
      args.push("--memory", this.options.memoryLimit);
    }

    // Bind mount workspace
    const cwd = this.options.cwd ?? process.cwd();
    if (existsSync(cwd)) {
      args.push("-v", `${cwd}:/workspace`);
    }

    // Bind mount skeleton credentials (read-only)
    const credsDir = join(getSkeletonDir(), "credentials");
    if (existsSync(credsDir)) {
      args.push("-v", `${credsDir}:/root/.skeleton/credentials:ro`);
    }

    // User-specified volumes
    for (const vol of this.options.volumes ?? []) {
      args.push("-v", vol);
    }

    // Forward env vars into container
    const forwardEnv = this.options.forwardEnv ?? [];
    const subEnv = buildSubprocessEnv();
    for (const key of forwardEnv) {
      if (subEnv[key] !== undefined) {
        args.push("-e", `${key}=${subEnv[key]}`);
      }
    }

    // Working directory
    args.push("-w", "/workspace");

    // Image
    args.push(this.image);

    // Keep container alive
    args.push("sleep", "infinity");

    const result = await execAsync(`${this.dockerExe} ${args.join(" ")}`, 30000);
    if (result.exitCode !== 0) {
      throw new Error(`Failed to start Docker container: ${result.stderr}`);
    }

    this.containerId = result.stdout.trim();
    this._running = true;
    return this.containerId;
  }

  async exec(command: string, timeout?: number): Promise<SandboxExecResult> {
    if (!this.containerId || !this._running) {
      await this.start();
    }

    // Append CWD marker to track directory changes
    const wrappedCmd = `${command}; echo __SKELETON_CWD__; pwd -P >&2`;

    const args = [
      "exec",
      this.containerId!,
      "bash", "-c", wrappedCmd,
    ];

    return spawnAsync(this.dockerExe, args, {
      timeout: timeout ?? DEFAULT_TIMEOUT,
    });
  }

  async stop(): Promise<void> {
    if (!this.containerId) return;

    // Stop container
    await execAsync(`${this.dockerExe} stop ${this.containerId}`, 60000)
      .catch(() => {});

    // Remove container
    await execAsync(`${this.dockerExe} rm -f ${this.containerId}`, 30000)
      .catch(() => {});

    this.containerId = null;
    this._running = false;
  }

  isRunning(): boolean {
    return this._running && this.containerId !== null;
  }

  getContainerId(): string | null {
    return this.containerId;
  }

  getContainerName(): string {
    return this.containerName;
  }
}

// ── SSH Sandbox ─────────────────────────────────────────────────────────────

export class SSHSandbox {
  private socketPath: string;
  private _connected = false;

  private keyPath: string | undefined;

  constructor(
    private host: string,
    private user: string = process.env.SKELETON_SSH_USER ?? "root",
    private port: number = 22,
    keyPathArg?: string,
  ) {
    this.keyPath = keyPathArg ?? process.env.SKELETON_SSH_KEY ?? undefined;
    this.socketPath = controlPath(this.user, this.host, this.port);
  }

  private buildSshArgs(): string[] {
    const args: string[] = [
      "-o", "ControlMaster=auto",
      "-o", `ControlPath=${this.socketPath}`,
      "-o", "ControlPersist=300",
      "-o", "BatchMode=yes",
      "-o", "StrictHostKeyChecking=accept-new",
      "-o", "ConnectTimeout=10",
      "-p", String(this.port),
    ];
    if (this.keyPath) {
      args.push("-i", this.keyPath);
    }
    args.push(`${this.user}@${this.host}`);
    return args;
  }

  async connect(): Promise<void> {
    if (this._connected) return;

    // Ensure socket directory exists
    const socketDir = join(getSkeletonDir(), "ssh");
    if (!existsSync(socketDir)) mkdirSync(socketDir, { recursive: true });

    // Probe connection
    const args = [...this.buildSshArgs(), "echo", "SSH_OK"];
    const result = await spawnAsync("ssh", args, { timeout: 15000 });

    if (result.exitCode !== 0 && !result.stdout.includes("SSH_OK")) {
      throw new Error(`SSH connection failed: ${result.stderr || result.stdout}`);
    }

    this._connected = true;
  }

  async exec(command: string, timeout?: number): Promise<SandboxExecResult> {
    if (!this._connected) {
      await this.connect();
    }

    // Append CWD marker
    const wrappedCmd = `${command}; echo __SKELETON_CWD__; pwd -P >&2`;

    const args = [...this.buildSshArgs(), "bash", "-c", shellEscape(wrappedCmd)];
    return spawnAsync("ssh", args, { timeout: timeout ?? DEFAULT_TIMEOUT });
  }

  async disconnect(): Promise<void> {
    if (!this._connected) return;

    // Close the ControlMaster
    const args = [...this.buildSshArgs(), "-O", "exit"];
    await spawnAsync("ssh", args, { timeout: 5000 }).catch(() => {});

    this._connected = false;
  }

  isConnected(): boolean {
    // Check if socket file exists
    if (existsSync(this.socketPath)) {
      return true;
    }
    this._connected = false;
    return false;
  }

  getSocketPath(): string {
    return this.socketPath;
  }
}

// ── Module-level Singletons ─────────────────────────────────────────────────

let dockerSandbox: DockerSandbox | null = null;
let sshSandbox: SSHSandbox | null = null;

function getDockerSandbox(config?: Partial<SandboxConfig>): DockerSandbox {
  const image = config?.dockerImage ?? getDockerImage();
  if (!dockerSandbox || dockerSandbox.isRunning() === false) {
    dockerSandbox = new DockerSandbox(image, {
      cwd: config?.dockerCwd,
    });
  }
  return dockerSandbox;
}

function getSshSandbox(config?: Partial<SandboxConfig>): SSHSandbox | null {
  const host = config?.sshHost ?? process.env.SKELETON_SSH_HOST ?? "";
  if (!host) return null;

  if (!sshSandbox) {
    sshSandbox = new SSHSandbox(
      host,
      config?.sshUser ?? process.env.SKELETON_SSH_USER ?? "root",
      22,
      config?.sshKey ?? process.env.SKELETON_SSH_KEY ?? undefined,
    );
  }
  return sshSandbox;
}

// ── Core Execution ───────────────────────────────────────────────────────────

export async function executeInSandbox(
  command: string,
  config: Partial<SandboxConfig> = {},
): Promise<SandboxExecResult> {
  const backend = config.backend ?? detectBackend();
  const timeout = config.defaultTimeout ?? DEFAULT_TIMEOUT;

  if (!command.trim()) {
    return { stdout: "", stderr: "Empty command", exitCode: 1, durationMs: 0 };
  }

  switch (backend) {
    case "docker": {
      const sandbox = getDockerSandbox(config);
      const result = await sandbox.exec(command, timeout);
      updateCwdFromOutput(result.stderr);
      return result;
    }

    case "ssh": {
      const sandbox = getSshSandbox(config);
      if (!sandbox) {
        return { stdout: "", stderr: "SKELETON_SSH_HOST not configured", exitCode: 1, durationMs: 0 };
      }
      const result = await sandbox.exec(command, timeout);
      updateCwdFromOutput(result.stderr);
      return result;
    }

    case "local":
    default: {
      const cwd = getEffectiveCwd();
      const wrappedCmd = `${command}; echo __SKELETON_CWD__; pwd -P >&2`;
      const result = await spawnAsync("bash", ["-c", wrappedCmd], {
        timeout,
        cwd,
        env: buildSubprocessEnv(),
      });
      updateCwdFromOutput(result.stderr);
      // Strip CWD marker from stdout before returning
      result.stdout = stripCwdMarker(result.stdout);
      return result;
    }
  }
}

/** Cleanup all sandbox resources (call on session end) */
export async function cleanupSandboxes(): Promise<void> {
  if (dockerSandbox) {
    await dockerSandbox.stop().catch(() => {});
    dockerSandbox = null;
  }
  if (sshSandbox) {
    await sshSandbox.disconnect().catch(() => {});
    sshSandbox = null;
  }
}

// ── Terminal Tool ────────────────────────────────────────────────────────────

export function sandboxTerminalTool(): ToolDef {
  const backend = detectBackend();

  return {
    name: "terminal",
    description:
      `Execute a shell command in a ${backend} sandbox environment. ` +
      (backend === "docker" ? "Runs inside a Docker container for isolation. " : "") +
      (backend === "ssh" ? "Runs on a remote SSH host. " : "") +
      "DANGEROUS — requires approval for all commands.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute" },
        timeout: { type: "number", default: 30000, description: "Timeout in ms" },
        cwd: { type: "string", description: "Working directory" },
        env: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Additional environment variables (merged after blocklist filtering)",
        },
      },
      required: ["command"],
    },
    execute: async (args) => {
      const { command, timeout = 30000, cwd, env } = args as {
        command: string;
        timeout?: number;
        cwd?: string;
        env?: Record<string, string>;
      };
      if (!command.trim()) return { error: "Empty command" };

      try {
        const result = await executeInSandbox(command, {
          defaultTimeout: Math.min(timeout, 300000),
          dockerCwd: cwd,
        });

        const output = result.stdout || result.stderr || "(no output)";
        if (output.length > 50000) {
          return output.slice(0, 20000) +
            `\n[...truncated at ${output.length} chars...]` +
            output.slice(-10000);
        }
        if (result.exitCode !== 0) {
          return `Exit code ${result.exitCode}\n${output}`;
        }
        return output;
      } catch (err) {
        return `Error: ${(err as Error).message}`;
      }
    },
    toolset: "system",
    emoji: "💻",
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function execAsync(
  command: string,
  timeout: number,
  options?: { cwd?: string; env?: Record<string, string> },
): Promise<SandboxExecResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    exec(command, {
      timeout,
      maxBuffer: 1024 * 1024,
      cwd: options?.cwd,
      env: options?.env,
    }, (error, stdout, stderr) => {
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        exitCode: error ? (error as NodeJS.ErrnoException).code ?? 1 : 0,
        durationMs: Date.now() - start,
      });
    });
  });
}

function spawnAsync(
  cmd: string,
  args: string[],
  options: { timeout?: number; cwd?: string; env?: Record<string, string> },
): Promise<SandboxExecResult> {
  const start = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, options.timeout ?? DEFAULT_TIMEOUT);

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? 1,
        durationMs: Date.now() - start,
      });
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({
        stdout: "",
        stderr: err.message,
        exitCode: 1,
        durationMs: Date.now() - start,
      });
    });
  });
}
