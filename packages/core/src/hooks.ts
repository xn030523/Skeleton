/**
 * Shell Hooks — event-driven hook system for pre/post tool and LLM calls.
 *
 * Supports: pre_tool_call, post_tool_call, pre_llm_call, post_llm_call,
 * on_error, on_session_start, on_session_end.
 *
 * Hooks are async functions that can modify args, block calls, or
 * inject context. Blocking hooks return { blocked: true, reason }.
 *
 * Inspired by Hermes shell_hooks.py + event hooks.
 */

export type HookEvent =
  | "pre_tool_call"
  | "post_tool_call"
  | "pre_llm_call"
  | "post_llm_call"
  | "transform_llm_output"
  | "on_error"
  | "on_session_start"
  | "on_session_end";

export interface HookContext {
  toolName?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  error?: Error;
  durationMs?: number;
}

export interface HookResult {
  blocked?: boolean;
  reason?: string;
  modifiedArgs?: Record<string, unknown>;
  contextInjection?: string;
  transformedContent?: string;
}

export type HookHandler = (ctx: HookContext) => Promise<HookResult | void>;

interface HookEntry {
  event: HookEvent;
  handler: HookHandler;
  name: string;
}

export class HookRegistry {
  private hooks = new Map<HookEvent, HookEntry[]>();

  /** Register a hook handler for a specific event */
  register(event: HookEvent, handler: HookHandler, name?: string): void {
    if (!this.hooks.has(event)) {
      this.hooks.set(event, []);
    }
    this.hooks.get(event)!.push({ event, handler, name: name ?? `hook_${Date.now()}` });
  }

  /** Remove a hook by name */
  unregister(name: string): boolean {
    for (const [, entries] of this.hooks) {
      const idx = entries.findIndex(e => e.name === name);
      if (idx >= 0) {
        entries.splice(idx, 1);
        return true;
      }
    }
    return false;
  }

  /** Fire all hooks for an event, in registration order */
  async emit(event: HookEvent, ctx: HookContext = {}): Promise<HookResult> {
    const entries = this.hooks.get(event) ?? [];
    let mergedResult: HookResult = {};

    for (const entry of entries) {
      try {
        const result = await entry.handler(ctx) ?? {};
        if (result.blocked) {
          return { blocked: true, reason: result.reason ?? `Blocked by hook "${entry.name}"` };
        }
        if (result.modifiedArgs) {
          mergedResult.modifiedArgs = { ...mergedResult.modifiedArgs, ...result.modifiedArgs };
        }
        if (result.contextInjection) {
          mergedResult.contextInjection = (mergedResult.contextInjection ?? "") + result.contextInjection + "\n";
        }
        if (result.transformedContent !== undefined) {
          mergedResult.transformedContent = result.transformedContent;
        }
      } catch (err) {
        console.warn(`Hook "${entry.name}" error on ${event}: ${(err as Error).message}`);
      }
    }

    return mergedResult;
  }

  /** List all registered hooks */
  list(): Array<{ event: HookEvent; name: string }> {
    const result: Array<{ event: HookEvent; name: string }> = [];
    for (const [event, entries] of this.hooks) {
      for (const entry of entries) {
        result.push({ event, name: entry.name });
      }
    }
    return result;
  }

  /** Remove all hooks */
  clear(): void {
    this.hooks.clear();
  }
}
