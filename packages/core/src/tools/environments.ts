/**
 * Environment Backends — 7 execution environment backends.
 * Base class + local, docker, ssh (existing in sandbox.ts),
 * plus Modal, Daytona, Singularity, Vercel Sandbox.
 *
 * Inspired by Hermes tools/environments/ (9 backends).
 */

import type { SandboxConfig } from "../sandbox.js";
import { executeInSandbox } from "../sandbox.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
}

export interface EnvironmentBackend {
  name: string;
  spawn(command: string, args: string[], options?: { cwd?: string; env?: Record<string, string>; timeout?: number }): Promise<ExecResult>;
  isAvailable(): boolean;
}

/** Modal backend — serverless GPU/CPU execution */
export class ModalBackend implements EnvironmentBackend {
  name = "modal";
  isAvailable(): boolean { return !!process.env.MODAL_TOKEN_ID; }
  async spawn(command: string, args: string[], options?: { cwd?: string; env?: Record<string, string>; timeout?: number }): Promise<ExecResult> {
    const start = Date.now();
    const { execSync } = await import("node:child_process");
    try {
      const result = execSync(
        `modal run -- cmd ${command} ${args.join(" ")}`,
        { timeout: options?.timeout ?? 30000, encoding: "utf-8", env: { ...process.env, ...options?.env } },
      );
      return { stdout: result, stderr: "", exitCode: 0, durationMs: Date.now() - start };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.status ?? 1, durationMs: Date.now() - start };
    }
  }
}

/** Daytona backend — cloud dev environment */
export class DaytonaBackend implements EnvironmentBackend {
  name = "daytona";
  isAvailable(): boolean { return !!process.env.DAYTONA_API_KEY; }
  async spawn(command: string, args: string[], options?: { cwd?: string; env?: Record<string, string>; timeout?: number }): Promise<ExecResult> {
    const apiKey = process.env.DAYTONA_API_KEY!;
    const serverUrl = process.env.DAYTONA_SERVER_URL ?? "https://api.daytona.io";
    const start = Date.now();
    try {
      const resp = await fetch(`${serverUrl}/execute`, {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ command: `${command} ${args.join(" ")}`, cwd: options?.cwd, env: options?.env, timeout: options?.timeout }),
        signal: AbortSignal.timeout(options?.timeout ?? 30000),
      });
      const data = await resp.json() as { stdout?: string; stderr?: string; exitCode?: number };
      return { stdout: data.stdout ?? "", stderr: data.stderr ?? "", exitCode: data.exitCode ?? 0, durationMs: Date.now() - start };
    } catch (err) {
      return { stdout: "", stderr: (err as Error).message, exitCode: 1, durationMs: Date.now() - start };
    }
  }
}

/** Singularity backend — HPC container execution */
export class SingularityBackend implements EnvironmentBackend {
  name = "singularity";
  isAvailable(): boolean {
    try { require("node:child_process").execSync("which singularity 2>/dev/null"); return true; } catch { return false; }
  }
  async spawn(command: string, args: string[], options?: { cwd?: string; env?: Record<string, string>; timeout?: number }): Promise<ExecResult> {
    const image = process.env.SKELETON_SINGULARITY_IMAGE ?? "docker://ubuntu:22.04";
    const start = Date.now();
    const { execSync } = await import("node:child_process");
    try {
      const result = execSync(
        `singularity exec ${image} ${command} ${args.join(" ")}`,
        { timeout: options?.timeout ?? 30000, encoding: "utf-8", cwd: options?.cwd, env: { ...process.env, ...options?.env } },
      );
      return { stdout: result, stderr: "", exitCode: 0, durationMs: Date.now() - start };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; status?: number };
      return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: e.status ?? 1, durationMs: Date.now() - start };
    }
  }
}

/** Vercel Sandbox backend — serverless sandboxed execution */
export class VercelSandboxBackend implements EnvironmentBackend {
  name = "vercel-sandbox";
  isAvailable(): boolean { return !!process.env.VERCEL_TOKEN; }
  async spawn(command: string, args: string[], options?: { cwd?: string; env?: Record<string, string>; timeout?: number }): Promise<ExecResult> {
    const token = process.env.VERCEL_TOKEN!;
    const start = Date.now();
    try {
      const resp = await fetch("https://api.vercel.com/v1/sandbox/execute", {
        method: "POST",
        headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ command: `${command} ${args.join(" ")}`, env: options?.env, timeout: options?.timeout }),
        signal: AbortSignal.timeout(options?.timeout ?? 30000),
      });
      const data = await resp.json() as { stdout?: string; stderr?: string; exitCode?: number };
      return { stdout: data.stdout ?? "", stderr: data.stderr ?? "", exitCode: data.exitCode ?? 0, durationMs: Date.now() - start };
    } catch (err) {
      return { stdout: "", stderr: (err as Error).message, exitCode: 1, durationMs: Date.now() - start };
    }
  }
}

/** Resolve the appropriate backend from config or env */
export function resolveBackend(config?: SandboxConfig): EnvironmentBackend {
  const backend = config?.backend ?? process.env.SKELETON_SANDBOX ?? "local";

  switch (backend) {
    case "modal": return new ModalBackend();
    case "daytona": return new DaytonaBackend();
    case "singularity": return new SingularityBackend();
    case "vercel": case "vercel-sandbox": return new VercelSandboxBackend();
    default: {
      // Route local/docker/ssh through sandbox.ts executeInSandbox
      return {
        name: backend,
        isAvailable: () => true,
        spawn: async (cmd, a, o) => {
          const result = await executeInSandbox(`${cmd} ${a.join(" ")}`, {
            backend: backend as "local" | "docker" | "ssh",
            defaultTimeout: o?.timeout,
            dockerCwd: o?.cwd,
          });
          return {
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
            durationMs: result.durationMs,
          };
        },
      } as EnvironmentBackend;
    }
  }
}
