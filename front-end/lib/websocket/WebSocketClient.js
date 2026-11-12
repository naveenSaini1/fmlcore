import { WS_EVENTS } from "./WebSocketEvents";

export class WebSocketClient {
  constructor({
    url = null,
    getTicket = null,
    reconnect = true,
    maxReconnectAttempts = 12,
  } = {}) {
    this.customUrl = url;
    this.getTicket = getTicket;
    this.shouldReconnect = reconnect;
    this.maxReconnectAttempts = maxReconnectAttempts;

    this.socket = null;
    this.status = "disconnected"; // "disconnected" | "connecting" | "connected" | "reconnecting"
    this.listeners = new Map();
    this.statusListeners = new Set();
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.explicitDisconnect = false;
    this.connectionVersion = 0;
    this.connecting = false;
  }

  _resolveUrl() {
    if (this.customUrl) return this.customUrl;
    if (typeof window === "undefined") return "ws://localhost:8000/ws";

    // In local dev, backend FastAPI is on port 8000
    const host = window.location.hostname || "localhost";
    const port = process.env.NEXT_PUBLIC_BACKEND_PORT || "8000";
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return process.env.NODE_ENV === "production" ? `${protocol}//${window.location.host}/ws` : `${protocol}//${host}:${port}/ws`;
  }

  _setStatus(newStatus) {
    if (this.status === newStatus) return;
    this.status = newStatus;
    for (const listener of this.statusListeners) {
      try {
        listener(newStatus);
      } catch (err) {
        console.error("Error in status listener:", err);
      }
    }
  }

  onStatusChange(callback) {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  getConnectionState() {
    return this.status;
  }

  async connect() {
    if (typeof window === "undefined") return;
    if (this.connecting) return;
    if (this.socket && (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.explicitDisconnect = false;
    this.connecting = true;
    const version = ++this.connectionVersion;
    this._setStatus(this.reconnectAttempts > 0 ? "reconnecting" : "connecting");

    let ticket = null;
    if (this.getTicket) {
      try {
        ticket = await this.getTicket();
      } catch (err) {
        console.warn("Could not fetch WS ticket; connecting with cookies:", err);
      }
    }

    if (version !== this.connectionVersion) return;
    this.connecting = false;
    const baseUrl = this._resolveUrl();
    const wsUrl = ticket ? `${baseUrl}?ticket=${encodeURIComponent(ticket)}` : baseUrl;

    try {
      this.socket = new WebSocket(wsUrl);
    } catch (err) {
      console.error("Failed to construct WebSocket:", err);
      this._scheduleReconnect();
      return;
    }

    const socket = this.socket;
    this.socket.onopen = () => {
      if (this.socket !== socket) return;
      this.reconnectAttempts = 0;
      this._setStatus("connected");
      this._startPing();

      // If we had a ticket, also send authenticate event as redundancy
      if (ticket) {
        this.send(WS_EVENTS.AUTH_AUTHENTICATE, { ticket });
      }
    };

    this.socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      try {
        const payload = JSON.parse(event.data);
        const eventName = payload.event;
        if (!eventName) return;

        const callbacks = this.listeners.get(eventName);
        if (callbacks) {
          for (const cb of callbacks) {
            try {
              cb(payload.data, payload);
            } catch (err) {
              console.error(`Error in WebSocket listener for ${eventName}:`, err);
            }
          }
        }

        // Wildcard / all-events listener
        const anyCallbacks = this.listeners.get("*");
        if (anyCallbacks) {
          for (const cb of anyCallbacks) {
            try {
              cb(eventName, payload.data, payload);
            } catch (err) {
              console.error("Error in wildcard WebSocket listener:", err);
            }
          }
        }
      } catch (err) {
        console.warn("Failed to parse incoming WebSocket message:", err);
      }
    };

    this.socket.onerror = (err) => {
      console.warn("WebSocket encountered error:", err);
    };

    this.socket.onclose = (event) => {
      if (this.socket !== socket) return;
      this._stopPing();
      this.socket = null;
      if (this.explicitDisconnect) {
        this._setStatus("disconnected");
        return;
      }

      // If closed with auth failure code (4001/4003), do not auto-reconnect
      if (event.code === 4001 || event.code === 4003) {
        console.warn("WebSocket closed due to authentication error.");
        this._setStatus("disconnected");
        return;
      }

      this._scheduleReconnect();
    };
  }

  disconnect() {
    this.explicitDisconnect = true;
    this.connectionVersion += 1;
    this.connecting = false;
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this._stopPing();
    if (this.socket) {
      try {
        this.socket.close(1000, "Client disconnected");
      } catch {}
      this.socket = null;
    }
    this._setStatus("disconnected");
  }

  _scheduleReconnect() {
    if (this.explicitDisconnect || !this.shouldReconnect) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn("WebSocket reached max reconnection attempts.");
      this._setStatus("disconnected");
      return;
    }

    this._setStatus("reconnecting");
    // Exponential backoff: 1s, 2s, 4s, up to 15s + jitter
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 15000) + Math.random() * 500;
    this.reconnectAttempts += 1;

    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  _startPing() {
    this._stopPing();
    this.pingTimer = setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        this.send(WS_EVENTS.CONNECTION_PING, {});
      }
    }, 30000);
  }

  _stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  send(event, data = {}, eventId = null) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    const payload = {
      event,
      event_id: eventId || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      timestamp: new Date().toISOString(),
      data: data || {},
    };

    try {
      this.socket.send(JSON.stringify(payload));
      return true;
    } catch (err) {
      console.error("Failed to send WebSocket event:", err);
      return false;
    }
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    const set = this.listeners.get(event);
    if (set) {
      set.delete(callback);
      if (set.size === 0) {
        this.listeners.delete(event);
      }
    }
  }
}
