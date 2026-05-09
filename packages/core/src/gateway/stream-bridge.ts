/**
 * Stream Bridge — wraps synchronous tool calls into async streaming
 * delivery with backpressure control and completion signals.
 */

export interface StreamChunk {
  index: number;
  data: unknown;
  done: boolean;
}

export type SyncToolFn = (args: Record<string, unknown>) => unknown;

export type SyncToolWrapper = (args: Record<string, unknown>) => AsyncGenerator<StreamChunk, void, void>;

type Subscriber = (chunk: StreamChunk) => void;

export class StreamBridge {
  private chunks: StreamChunk[] = [];
  private subscribers: Subscriber[] = [];
  private done = false;
  private maxBuffer: number;

  constructor(maxBuffer = 64) {
    this.maxBuffer = maxBuffer;
  }

  /** Wrap a sync tool function into an async generator that yields StreamChunks */
  wrapSyncTool(fn: SyncToolFn): SyncToolWrapper {
    return async function* (args: Record<string, unknown>): AsyncGenerator<StreamChunk, void, void> {
      const result = fn(args);
      yield { index: 0, data: result, done: false };
      yield { index: 1, data: undefined, done: true };
    };
  }

  /** Feed a data chunk into the bridge; returns false if backpressure applies */
  feed(data: unknown): boolean {
    if (this.done) return false;
    if (this.chunks.length >= this.maxBuffer) return false;

    const chunk: StreamChunk = {
      index: this.chunks.length,
      data,
      done: false,
    };

    this.chunks.push(chunk);
    for (const sub of this.subscribers) {
      sub(chunk);
    }
    return true;
  }

  /** Signal completion */
  complete(): void {
    this.done = true;
    const finalChunk: StreamChunk = {
      index: this.chunks.length,
      data: undefined,
      done: true,
    };
    this.chunks.push(finalChunk);
    for (const sub of this.subscribers) {
      sub(finalChunk);
    }
  }

  /** Subscribe to chunk updates; returns unsubscribe function */
  subscribe(): { onNext: (cb: Subscriber) => void; getChunks: () => StreamChunk[]; isDone: () => boolean } {
    return {
      onNext: (cb: Subscriber) => {
        this.subscribers.push(cb);
      },
      getChunks: () => [...this.chunks],
      isDone: () => this.done,
    };
  }

  /** Reset the bridge for reuse */
  reset(): void {
    this.chunks = [];
    this.subscribers = [];
    this.done = false;
  }
}
