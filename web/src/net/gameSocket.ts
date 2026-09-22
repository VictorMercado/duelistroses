import {
  buildWsUrl,
  type IncomingMessage,
  type NetEventType,
  type NetRole,
} from './protocol';

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'reconnecting'
  | 'closed';

export interface ConnectOptions {
  roomId: string;
  role: NetRole;
  name?: string;
}

type MessageListener = (message: IncomingMessage) => void;
type StatusListener = (status: ConnectionStatus, detail?: string) => void;

const MAX_RECONNECT_ATTEMPTS = 6;
const BASE_RECONNECT_DELAY_MS = 500;

/**
 * Thin websocket transport: JSON framing, status reporting and reconnect.
 * It knows nothing about the game - netManager translates messages into store
 * updates.
 */
export class GameSocket {
  private ws: WebSocket | null = null;
  private options: ConnectOptions | null = null;
  private status: ConnectionStatus = 'idle';
  private manuallyClosed = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private outbox: string[] = [];

  private messageListeners = new Set<MessageListener>();
  private statusListeners = new Set<StatusListener>();

  public connect(options: ConnectOptions) {
    this.disconnect();
    this.options = options;
    this.manuallyClosed = false;
    this.reconnectAttempts = 0;

    // The server reads the display name from a cookie during the upgrade.
    if (options.name) {
      document.cookie = `name=${encodeURIComponent(options.name)}; path=/; SameSite=Lax`;
    }

    this.open();
  }

  public disconnect() {
    this.manuallyClosed = true;
    this.clearReconnectTimer();
    this.outbox = [];

    if (this.ws) {
      // Drop handlers first so the close does not schedule a reconnect.
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close(1000, 'client disconnect');
      }
      this.ws = null;
    }

    if (this.status !== 'idle') this.setStatus('closed');
  }

  public send(type: NetEventType, payload: unknown) {
    const frame = JSON.stringify({ type, payload });

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(frame);
      return;
    }

    // Queue while (re)connecting so an action is not silently dropped.
    if (!this.manuallyClosed) this.outbox.push(frame);
  }

  public getStatus() {
    return this.status;
  }

  public isConnected() {
    return this.status === 'open';
  }

  public onMessage(listener: MessageListener) {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  public onStatus(listener: StatusListener) {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private open() {
    if (!this.options) return;

    const url = buildWsUrl(this.options.roomId, this.options.role);
    this.setStatus(this.reconnectAttempts === 0 ? 'connecting' : 'reconnecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err) {
      this.setStatus('closed', String(err));
      this.scheduleReconnect();
      return;
    }

    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.setStatus('open');
      const queued = this.outbox;
      this.outbox = [];
      queued.forEach((frame) => ws.send(frame));
    };

    ws.onmessage = (event) => {
      let message: IncomingMessage;
      try {
        message = JSON.parse(event.data as string);
      } catch {
        console.warn('[net] dropped malformed frame', event.data);
        return;
      }
      if (!message || typeof message.type !== 'string') return;
      this.messageListeners.forEach((listener) => listener(message));
    };

    ws.onerror = () => {
      // onclose always follows, reconnect is handled there.
      console.warn('[net] websocket error');
    };

    ws.onclose = (event) => {
      this.ws = null;
      if (this.manuallyClosed) {
        this.setStatus('closed');
        return;
      }
      // The server closes with a normal-closure frame when the room is full;
      // reconnecting would just bounce again.
      if (event.code === 1000 && event.reason) {
        this.manuallyClosed = true;
        this.setStatus('closed', event.reason);
        return;
      }
      this.setStatus('closed', event.reason || 'connection lost');
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.manuallyClosed) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.setStatus('closed', 'could not reach the game server');
      return;
    }

    const delay = BASE_RECONNECT_DELAY_MS * 2 ** this.reconnectAttempts;
    this.reconnectAttempts++;
    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private setStatus(status: ConnectionStatus, detail?: string) {
    this.status = status;
    this.statusListeners.forEach((listener) => listener(status, detail));
  }
}
