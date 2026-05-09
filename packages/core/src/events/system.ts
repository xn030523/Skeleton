/**
 * Event Hook System — lifecycle event dispatch for session/gateway/agent events.
 *
 * Events: gateway:startup, session:start, session:end, agent:start, agent:step, agent:end
 * Handlers fire in registration order; errors are caught and never block.
 *
 * Inspired by Hermes gateway/hooks.py.
 */

export type GatewayEvent =
  | "gateway:startup"
  | "gateway:shutdown"
  | "session:start"
  | "session:end"
  | "agent:start"
  | "agent:step"
  | "agent:end"
  | "command:execute"
  | "command:complete";

export interface EventPayload {
  sessionId?: string;
  userId?: string;
  model?: string;
  provider?: string;
  toolName?: string;
  durationMs?: number;
  tokensUsed?: { prompt: number; completion: number };
  error?: string;
  [key: string]: unknown;
}

export type EventHandler = (event: GatewayEvent, payload: EventPayload) => void | Promise<void>;

interface HandlerEntry {
  handler: EventHandler;
  name: string;
  priority: number;
}

export class EventSystem {
  private handlers = new Map<GatewayEvent, HandlerEntry[]>();

  /** Register a handler for a specific event */
  on(event: GatewayEvent, handler: EventHandler, name?: string, priority = 0): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push({ handler, name: name ?? `handler_${Date.now()}`, priority });
    // Sort by priority (lower = earlier)
    this.handlers.get(event)!.sort((a, b) => a.priority - b.priority);
  }

  /** Remove a handler by name */
  off(name: string): boolean {
    for (const [, entries] of this.handlers) {
      const idx = entries.findIndex(e => e.name === name);
      if (idx >= 0) { entries.splice(idx, 1); return true; }
    }
    return false;
  }

  /** Emit an event — fire all handlers, errors caught and logged */
  async emit(event: GatewayEvent, payload: EventPayload = {}): Promise<void> {
    const entries = this.handlers.get(event) ?? [];
    for (const entry of entries) {
      try {
        await entry.handler(event, payload);
      } catch (err) {
        console.warn(`Event handler "${entry.name}" error on ${event}: ${(err as Error).message}`);
      }
    }
  }

  /** List all registered handlers */
  list(): Array<{ event: GatewayEvent; name: string; priority: number }> {
    const result: Array<{ event: GatewayEvent; name: string; priority: number }> = [];
    for (const [event, entries] of this.handlers) {
      for (const entry of entries) {
        result.push({ event, name: entry.name, priority: entry.priority });
      }
    }
    return result;
  }

  clear(): void { this.handlers.clear(); }
}
