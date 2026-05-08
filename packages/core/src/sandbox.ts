/**
 * Sandbox execution backends — run commands in isolated environments.
 *
 * Supported backends:
 * - local: direct execution (default, no isolation)
 * - docker: Docker container execution
 * - ssh: remote SSH execution
 *
 * Inspired by Hermes terminal_tool.py's 11 backends (simplified).
 */

import { exec } from "node:child_process";
import type { ToolDef } from "../types.js";

export type SandboxBackend = "local" | "docker" | "ssh";

export interface SandboxConfig {
  backend: SandboxBackend;
  dockerImage?: string;
  dockerCwd?: string;
  sshHost?: string;
  sshUser?: string;
  sshKey?: string;
  sshCwd?: string;
  defaultTimeout?: number;
}

const DEFAULT_TIMEOUT = 30000;

function detectBackend(): SandboxBackend {
  const env = process.env.SKELETON_SANDBOX ?? "local";
  if (env === "docker") return "docker";
  if (env === "ssh") return "ssh";
  return "local";
}

function getDockerImage(): string {
  return process.env.SKELETON_DOCKER_IMAGE ?? "ubuntu:22.04";
}

function getSshHost(): string {
  return process.env.SKELETON_SSH_HOST ?? "";
}

/** Build the actual command string for the chosen backend */
function buildCommand(command: string, config: SandboxConfig): string {
  switch (config.backend) {
    case "docker": {
      const image = config.dockerImage ?? getDockerImage();
      const cwd = config.dockerCwd ?? "/workspace";
      return `docker run --rm -w ${cwd} ${image} bash -c ${shellEscape(command)}`;
    }
    case "ssh": {
      const host = config.sshHost ?? getSshHost();
      if (!host) throw new Error("SKELETON_SSH_HOST not configured");
      const user = config.sshUser ?? process.env.SKELETON_SSH_USER ?? "root";
      const keyArg = config.sshKey ?? process.env.SKELETON_SSH_KEY ?? "";
      const keyFlag = keyArg ? `-i ${keyArg}` : "";
      return `ssh ${keyFlag} ${user}@${host} ${shellEscape(command)}`;
    }
    case "local":
    default:
      return command;
  }
}

function shellEscape(str: string): string {
  return `'${str.replace(/'/g, "'\\''")}'`;
}

/** Execute a command in the configured sandbox backend */
export async function executeInSandbox(
  command: string,
  config: Partial<SandboxConfig> = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const fullConfig: SandboxConfig = {
    backend: config.backend ?? detectBackend(),
    dockerImage: config.dockerImage,
    dockerCwd: config.dockerCwd,
    sshHost: config.sshHost,
    sshUser: config.sshUser,
    sshKey: config.sshKey,
    sshCwd: config.sshCwd,
    defaultTimeout: config.defaultTimeout ?? DEFAULT_TIMEOUT,
  };

  const actualCommand = buildCommand(command, fullConfig);

  return new Promise((resolve) => {
    exec(
      actualCommand,
      {
        timeout: fullConfig.defaultTimeout,
        maxBuffer: 1024 * 1024,
        cwd: fullConfig.backend === "local" ? undefined : undefined,
      },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          exitCode: error ? (error as NodeJS.ErrnoException).code ? 1 : 1 : 0,
        });
      },
    );
  });
}

/** Build a sandbox-aware terminal tool */
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
      },
      required: ["command"],
    },
    execute: async (args) => {
      const { command, timeout = 30000 } = args as { command: string; timeout?: number };
      if (!command.trim()) return { error: "Empty command" };

      try {
        const result = await executeInSandbox(command, { defaultTimeout: Math.min(timeout, 300000) });
        const output = result.stdout || result.stderr || "(no output)";
        if (output.length > 50000) {
          return output.slice(0, 20000) + `\n[...truncated at ${output.length} chars...]` + output.slice(-10000);
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
