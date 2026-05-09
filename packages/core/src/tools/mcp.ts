import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { ToolDef } from "../types.js";
import type { McpServerConfig } from "../config/index.js";
import { isCommandAvailable, checkCommandAvailability } from "../mcp/resolve.js";

type ToolListChangedCallback = (serverName: string) => void;

let onToolListChanged: ToolListChangedCallback | null = null;

/** Register callback for MCP tools/list_changed notifications */
export function setOnToolListChanged(cb: ToolListChangedCallback): void {
  onToolListChanged = cb;
}

// ─── Circuit Breaker ─────────────────────────────────────────────────────────

interface CircuitBreakerState {
  failureCount: number;
  openedAt: number;
  isOpen: boolean;
}

const CIRCUIT_BREAKER_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;

const circuitBreakers = new Map<string, CircuitBreakerState>();

function getBreaker(name: string): CircuitBreakerState {
  if (!circuitBreakers.has(name)) {
    circuitBreakers.set(name, { failureCount: 0, openedAt: 0, isOpen: false });
  }
  return circuitBreakers.get(name)!;
}

function bumpFailure(name: string): void {
  const b = getBreaker(name);
  b.failureCount++;
  if (b.failureCount >= CIRCUIT_BREAKER_THRESHOLD) {
    b.isOpen = true;
    b.openedAt = Date.now();
  }
}

function resetBreaker(name: string): void {
  const b = getBreaker(name);
  b.failureCount = 0;
  b.isOpen = false;
}

function checkBreaker(name: string): { allowed: boolean; reason?: string } {
  const b = getBreaker(name);
  if (!b.isOpen) return { allowed: true };

  const elapsed = Date.now() - b.openedAt;
  if (elapsed >= CIRCUIT_BREAKER_COOLDOWN_MS) {
    // Half-open: allow one probe
    b.isOpen = false;
    b.failureCount = 0;
    return { allowed: true };
  }

  return { allowed: false, reason: `MCP server "${name}" is unreachable (circuit breaker open, ${Math.ceil((CIRCUIT_BREAKER_COOLDOWN_MS - elapsed) / 1000)}s cooldown remaining)` };
}

// ─── MCP Server State Tracker ───────────────────────────────────────────────

interface McpServerState {
  name: string;
  config: McpServerConfig;
  client: Client;
  toolNames: string[];
  connected: boolean;
  lastKeepalive: number;
}

const serverStates = new Map<string, McpServerState>();

// ─── Keepalive ──────────────────────────────────────────────────────────────

const KEEPALIVE_INTERVAL_MS = 180_000;
let keepaliveTimer: ReturnType<typeof setInterval> | null = null;

function startKeepalive(): void {
  if (keepaliveTimer) return;
  keepaliveTimer = setInterval(async () => {
    for (const [name, state] of serverStates.entries()) {
      if (!state.connected) continue;
      try {
        await state.client.listTools();
        state.lastKeepalive = Date.now();
      } catch (err) {
        console.warn(`MCP keepalive failed for "${name}": ${(err as Error).message}`);
        state.connected = false;
        bumpFailure(name);
      }
    }
  }, KEEPALIVE_INTERVAL_MS);
  // Don't prevent Node.js exit
  if (keepaliveTimer.unref) keepaliveTimer.unref();
}

function stopKeepalive(): void {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}

// ─── Core Connection ────────────────────────────────────────────────────────

export async function connectMcpServer(name: string, config: McpServerConfig): Promise<{ tools: ToolDef[]; client: Client }> {
  const client = new Client({ name: "skeleton", version: "0.1.0" });

  let transport;
  if (config.url) {
    const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamable-http.js");
    transport = new StreamableHTTPClientTransport(new URL(config.url), {
      requestInit: { headers: config.headers },
    });
  } else if (config.command) {
    // Pre-flight: verify command exists before spawning subprocess (Hermes-style)
    if (!isCommandAvailable(config.command)) {
      const cmdCheck = checkCommandAvailability(config.command);
      const hint = cmdCheck.installHint ?? "Install the required tool and try again.";
      throw new Error(`MCP server "${name}": command "${config.command}" not found on this system. ${hint}`);
    }

    transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: { ...process.env as Record<string, string>, ...config.env },
    });
  } else {
    throw new Error(`MCP server "${name}" must have either "command" or "url"`);
  }

  await client.connect(transport);

  // Listen for tools/list_changed notifications from the server
  client.setNotificationHandler(
    { method: "notifications/tools/list_changed" },
    () => {
      console.log(`MCP server "${name}" sent tools/list_changed — triggering refresh`);
      if (onToolListChanged) onToolListChanged(name);
    },
  );

  const { tools } = await client.listTools();

  const toolDefs: ToolDef[] = (tools ?? []).map((t) => {
    const originalName = t.name;
    return {
    name: t.name,
    description: t.description ?? "",
    parameters: (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
    execute: async (args: Record<string, unknown>) => {
      // Circuit breaker check before each call
      const breakerCheck = checkBreaker(name);
      if (!breakerCheck.allowed) {
        return { error: breakerCheck.reason };
      }

      try {
        const result = await client.callTool({ name: originalName, arguments: args });
        resetBreaker(name);
        // Mark connected on success
        const state = serverStates.get(name);
        if (state) state.connected = true;

        if (result.content && Array.isArray(result.content)) {
          const textParts = result.content
            .filter((c: any) => c.type === "text")
            .map((c: any) => c.text);
          if (textParts.length > 0) return textParts.join("\n");
          return JSON.stringify(result.content);
        }
        return JSON.stringify(result);
      } catch (err) {
        bumpFailure(name);
        // Mark disconnected on failure
        const state = serverStates.get(name);
        if (state) state.connected = false;
        throw err;
      }
    },
  }; });

  // Track server state
  serverStates.set(name, {
    name,
    config,
    client,
    toolNames: toolDefs.map((t) => t.name),
    connected: true,
    lastKeepalive: Date.now(),
  });

  resetBreaker(name);
  startKeepalive();

  return { tools: toolDefs, client };
}

export async function connectAllMcpServers(
  servers: Record<string, McpServerConfig>,
): Promise<{
  tools: ToolDef[];
  clients: Client[];
  serverToolMap: Record<string, { toolNames: string[]; client: Client; config: McpServerConfig }>;
}> {
  const allTools: ToolDef[] = [];
  const clients: Client[] = [];
  const serverToolMap: Record<string, { toolNames: string[]; client: Client; config: McpServerConfig }> = {};

  const entries = Object.entries(servers);
  const results = await Promise.allSettled(
    entries.map(([name, config]) => connectMcpServer(name, config)),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled") {
      const name = entries[i][0];
      const config = entries[i][1];
      const toolNames = result.value.tools.map((t) => t.name);
      allTools.push(...result.value.tools);
      clients.push(result.value.client);
      serverToolMap[name] = { toolNames, client: result.value.client, config };
    } else {
      const name = entries[i][0];
      console.error(`MCP server "${name}" failed: ${result.reason}`);
    }
  }

  return { tools: allTools, clients, serverToolMap };
}

// ─── Reconnection ───────────────────────────────────────────────────────────

const MAX_RECONNECT_ATTEMPTS = 3;
const BASE_RECONNECT_DELAY_MS = 1000;

export async function reconnectMcpServer(name: string): Promise<{ tools: ToolDef[]; client: Client } | null> {
  const state = serverStates.get(name);
  if (!state) return null;

  for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt++) {
    const delay = BASE_RECONNECT_DELAY_MS * Math.pow(2, attempt);
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      // Close old client
      try { (state.client as { close?: () => void }).close?.(); } catch {}

      const result = await connectMcpServer(name, state.config);
      console.log(`MCP server "${name}" reconnected on attempt ${attempt + 1}`);
      return result;
    } catch (err) {
      console.warn(`MCP reconnect attempt ${attempt + 1} for "${name}" failed: ${(err as Error).message}`);
    }
  }

  console.error(`MCP server "${name}" failed to reconnect after ${MAX_RECONNECT_ATTEMPTS} attempts`);
  return null;
}

// ─── Status & Cleanup ───────────────────────────────────────────────────────

export function getMcpServerStatus(): Array<{ name: string; connected: boolean; breakerOpen: boolean; lastKeepalive: number }> {
  return [...serverStates.values()].map((s) => ({
    name: s.name,
    connected: s.connected,
    breakerOpen: getBreaker(s.name).isOpen,
    lastKeepalive: s.lastKeepalive,
  }));
}

export function shutdownAllMcpServers(): void {
  stopKeepalive();
  for (const state of serverStates.values()) {
    try { (state.client as { close?: () => void }).close?.(); } catch {}
  }
  serverStates.clear();
  circuitBreakers.clear();
}
