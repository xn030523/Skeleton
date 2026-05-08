import { exec } from "node:child_process";
import type { ToolDef } from "../../types.js";

const MAX_BUFFER = 1024 * 1024; // 1MB per stream

function truncateOutput(output: string, maxLen: number): string {
  if (output.length <= maxLen) return output;
  const headLen = Math.floor(maxLen * 0.4);
  const tailLen = maxLen - headLen - 30;
  return output.slice(0, headLen) + `\n\n... [truncated at ${output.length} bytes] ...\n\n` + output.slice(-tailLen);
}

export function terminalTool(): ToolDef {
  return {
    name: "terminal",
    description:
      "Execute a shell command locally and return its output. Supports timeout, working directory, and environment variables. DANGEROUS — requires approval for all commands. Use for running tools, scripts, build commands, and system utilities.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell command to execute",
        },
        timeout: {
          type: "number",
          default: 30000,
          description: "Execution timeout in milliseconds (default 30000, max 300000)",
        },
        cwd: {
          type: "string",
          description: "Working directory for command execution",
        },
        env: {
          type: "object",
          additionalProperties: { type: "string" },
          description: "Additional environment variables",
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

      const ms = Math.min(Math.max(1000, timeout), 300000);
      const start = Date.now();

      return new Promise((resolve) => {
        const execEnv = { ...process.env, ...(env ?? {}) };

        const child = exec(command, {
          timeout: ms,
          maxBuffer: MAX_BUFFER,
          cwd: cwd ?? process.cwd(),
          env: execEnv,
          shell: true,
        }, (err, stdout, stderr) => {
          const duration = Date.now() - start;
          const timedOut = !!err && (err as NodeJS.ErrnoException).killed === true;
          const exitCode = err ? (err as NodeJS.ErrnoException).code ?? 1 : 0;

          resolve({
            exitCode: typeof exitCode === "number" ? exitCode : 1,
            stdout: truncateOutput(stdout ?? "", 500000),
            stderr: truncateOutput(stderr ?? "", 100000),
            timedOut,
            command,
            duration,
          });
        });

        // Safety: ensure process doesn't hang beyond timeout
        setTimeout(() => {
          try {
            if (!child.killed) {
              child.kill("SIGKILL");
            }
          } catch {
            // process already exited
          }
        }, ms + 5000);
      });
    },
  };
}
