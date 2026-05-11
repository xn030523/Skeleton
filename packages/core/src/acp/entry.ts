/**
 * CLI entry point for the Skeleton ACP adapter.
 *
 * Loads environment variables, configures logging to stderr
 * (stdout reserved for ACP JSON-RPC transport), and starts the ACP agent server.
 *
 * Usage:
 *   skeleton acp
 *
 * Aligned with Hermes acp_adapter/entry.py.
 */

import * as acp from "@agentclientprotocol/sdk";
import { Writable, Readable } from "node:stream";
import { SkeletonACPAgent } from "./agent.js";
import { SessionManager } from "./session.js";

function setupLogging(): void {
  // All logging goes to stderr so stdout stays clean for ACP stdio
  const originalConsoleLog = console.log;
  console.log = (...args: any[]) => {
    process.stderr.write(args.join(" ") + "\n");
  };
}

export function runAcpServer(): void {
  setupLogging();

  // Config loaded from ~/.skeleton/config.json (no .env needed)

  process.stderr.write("Starting skeleton-agent ACP adapter\n");

  const sessionManager = new SessionManager();

  // Create ACP stdio stream
  const input = Writable.toWeb(process.stdout) as WritableStream<Uint8Array>;
  const output = Readable.toWeb(process.stdin) as ReadableStream<Uint8Array>;
  const stream = acp.ndJsonStream(input, output);

  // Start the ACP agent server
  new acp.AgentSideConnection(
    (conn) => new SkeletonACPAgent(conn, sessionManager),
    stream,
  );

  process.stderr.write("ACP agent server running on stdio\n");
}
