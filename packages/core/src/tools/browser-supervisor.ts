import { EventEmitter } from "node:events";

export interface FrameInfo {
  id: string;
  parentId?: string;
  url: string;
  name?: string;
}

export interface PendingDialog {
  type: "alert" | "confirm" | "prompt" | "beforeunload";
  message: string;
  url: string;
  timestamp: number;
}

export interface ConsoleEvent {
  level: string;
  text: string;
  url?: string;
  timestamp: number;
}

type PendingCall = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const MAX_RECONNECT_ATTEMPTS = 10;
const COMMAND_TIMEOUT_MS = 15000;

export class CdpSupervisor extends EventEmitter {
  private ws: InstanceType<typeof import("ws")["WebSocket"]> | null = null;
  private wsUrl = "";
  private msgId = 0;
  private pending = new Map<number, PendingCall>();
  private _connected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private targetId?: string;
  private sessionId?: string;
  private frames = new Map<string, FrameInfo>();
  private dialogs: PendingDialog[] = [];
  private consoleBuffer: ConsoleEvent[] = [];
  private readonly maxConsoleEntries = 50;

  isConnected(): boolean {
    return this._connected;
  }

  getWsUrl(): string {
    return this.wsUrl;
  }

  getFrameTree(): FrameInfo[] {
    return [...this.frames.values()];
  }

  getPendingDialogs(): PendingDialog[] {
    return [...this.dialogs];
  }

  getConsoleMessages(): ConsoleEvent[] {
    return [...this.consoleBuffer];
  }

  async connect(wsUrl: string): Promise<void> {
    this.disconnect();
    this.wsUrl = wsUrl;
    this.reconnectAttempts = 0;

    const { default: WebSocket } = await import("ws") as any;
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl, { maxReceivedFrameSize: 50 * 1024 * 1024 });
      const connectTimeout = setTimeout(() => {
        ws.terminate();
        reject(new Error("CDP connection timeout"));
      }, 10000);

      ws.once("open", () => {
        clearTimeout(connectTimeout);
        this.ws = ws;
        this._connected = true;
        this.emit("connected");
        this.enableDomains()
          .then(() => resolve())
          .catch(() => resolve());
      });

      ws.once("error", (err: Error) => {
        clearTimeout(connectTimeout);
        this._connected = false;
        reject(new Error(`CDP connection failed: ${err.message}`));
      });

      ws.on("message", (data: Buffer) => {
        try {
          this.onMessage(JSON.parse(data.toString()));
        } catch { /* ignore malformed frames */ }
      });

      ws.on("close", () => {
        this._connected = false;
        this.ws = null;
        this.rejectAllPending(new Error("WebSocket closed"));
        this.emit("disconnected");
        this.attemptReconnect();
      });
    });
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnectAttempts = MAX_RECONNECT_ATTEMPTS;
    if (this.ws) {
      try { this.ws.close(); } catch { /* ignore */ }
      this.ws = null;
    }
    this._connected = false;
    this.wsUrl = "";
    this.frames.clear();
    this.dialogs = [];
    this.targetId = undefined;
    this.sessionId = undefined;
    this.rejectAllPending(new Error("Disconnected"));
  }

  async send(method: string, params?: Record<string, unknown>): Promise<unknown> {
    if (!this.ws || !this._connected) {
      throw new Error("CDP not connected. Use /browser connect <ws-url> first.");
    }
    const id = ++this.msgId;
    const msg: Record<string, unknown> = { id, method };
    if (params) msg.params = params;
    if (this.sessionId) msg.sessionId = this.sessionId;

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timeout: ${method}`));
      }, COMMAND_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify(msg));
    });
  }

  private onMessage(frame: Record<string, unknown>): void {
    if ("id" in frame && frame.id != null) {
      const id = frame.id as number;
      const call = this.pending.get(id);
      if (call) {
        clearTimeout(call.timer);
        this.pending.delete(id);
        if ("error" in frame) {
          call.reject(new Error(`CDP error ${frame.error}`));
        } else {
          call.resolve(frame.result);
        }
      }
    } else if ("method" in frame && frame.params) {
      this.onEvent(frame.method as string, frame.params as Record<string, unknown>);
    }
  }

  private onEvent(method: string, params: Record<string, unknown>): void {
    switch (method) {
      case "Page.javascriptDialogOpening": {
        const dlg: PendingDialog = {
          type: (params.type as PendingDialog["type"]) ?? "alert",
          message: (params.message as string) ?? "",
          url: (params.url as string) ?? "",
          timestamp: Date.now(),
        };
        this.dialogs.push(dlg);
        this.emit("dialog", dlg);
        break;
      }
      case "Page.javascriptDialogClosed": {
        this.dialogs = this.dialogs.filter(
          d => d.message !== (params.message as string)
        );
        break;
      }
      case "Page.frameAttached": {
        const fi: FrameInfo = {
          id: params.frameId as string,
          parentId: params.parentFrameId as string | undefined,
          url: "",
        };
        this.frames.set(fi.id, fi);
        break;
      }
      case "Page.frameNavigated": {
        const existing = this.frames.get(params.frameId as string);
        if (existing) {
          existing.url = params.url as string;
        } else {
          this.frames.set(params.frameId as string, {
            id: params.frameId as string,
            url: params.url as string,
          });
        }
        break;
      }
      case "Page.frameDetached": {
        this.frames.delete(params.frameId as string);
        break;
      }
      case "Runtime.consoleAPICalled":
      case "Runtime.exceptionThrown": {
        const evt: ConsoleEvent = {
          level: method === "Runtime.exceptionThrown" ? "error" : "info",
          text: method === "Runtime.exceptionThrown"
            ? JSON.stringify(params.exceptionDetails?.exception ?? params)
            : (params.args as Array<{ value?: string }>)?.map(a => a.value ?? "").join(" ") ?? "",
          timestamp: Date.now(),
        };
        this.consoleBuffer.push(evt);
        if (this.consoleBuffer.length > this.maxConsoleEntries) {
          this.consoleBuffer.shift();
        }
        break;
      }
    }
    this.emit("event", method, params);
  }

  private async enableDomains(): Promise<void> {
    try {
      await this.send("Page.enable");
    } catch { /* page may already be enabled */ }
    try {
      await this.send("Runtime.enable");
    } catch { /* runtime may already be enabled */ }
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS || !this.wsUrl) return;
    this.reconnectAttempts++;
    const delay = Math.min(RECONNECT_BASE_MS * (2 ** (this.reconnectAttempts - 1)), RECONNECT_MAX_MS);
    this.reconnectTimer = setTimeout(() => {
      this.connect(this.wsUrl).catch(() => { /* will retry again */ });
    }, delay);
  }

  private rejectAllPending(reason: Error): void {
    for (const [, call] of this.pending) {
      clearTimeout(call.timer);
      call.reject(reason);
    }
    this.pending.clear();
  }
}

export const cdpSupervisor = new CdpSupervisor();
