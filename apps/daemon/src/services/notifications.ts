import notifier from "node-notifier";

export interface NotificationPayload {
  id: string;
  type: "success" | "error" | "info" | "warning";
  title: string;
  message: string;
  skillId?: string;
  runId?: string;
}

export interface NotificationServiceOptions {
  enableDesktop: boolean;
}

interface WebSocketLike {
  send: (data: string) => void;
  readyState: number;
}

const WS_OPEN = 1;

export class NotificationService {
  private connections: Map<string, WebSocketLike> = new Map();
  private enableDesktop: boolean;

  constructor(options: NotificationServiceOptions = { enableDesktop: true }) {
    this.enableDesktop = options.enableDesktop;
  }

  /**
   * Send a desktop notification using node-notifier.
   */
  async sendDesktopNotification(payload: NotificationPayload): Promise<void> {
    if (!this.enableDesktop) {
      return;
    }

    return new Promise((resolve) => {
      notifier.notify(
        {
          title: payload.title,
          message: payload.message,
          icon: this.getIconForType(payload.type),
          sound: true,
        },
        (err) => {
          if (err) {
            console.error("Desktop notification error:", err);
          }
          resolve();
        }
      );
    });
  }

  /**
   * Get icon path based on notification type.
   */
  private getIconForType(_type: NotificationPayload["type"]): string | undefined {
    // Return undefined to use system default icons
    // Could be extended to use custom icons
    return undefined;
  }

  /**
   * Add a WebSocket connection for real-time notifications.
   */
  addConnection(id: string, socket: WebSocketLike): void {
    this.connections.set(id, socket);
  }

  /**
   * Remove a WebSocket connection.
   */
  removeConnection(id: string): void {
    this.connections.delete(id);
  }

  /**
   * Get the number of active connections.
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Close all WebSocket connections.
   */
  closeAllConnections(): void {
    this.connections.clear();
  }

  /**
   * Broadcast a notification to all connected WebSocket clients.
   */
  broadcast(payload: NotificationPayload): void {
    const message = JSON.stringify({
      type: "notification",
      notification: payload,
    });

    for (const [id, socket] of this.connections.entries()) {
      if (socket.readyState === WS_OPEN) {
        try {
          socket.send(message);
        } catch (err) {
          console.error(`Failed to send to client ${id}:`, err);
          this.connections.delete(id);
        }
      }
    }
  }

  /**
   * Send notification via all channels (desktop + WebSocket).
   */
  async notify(payload: NotificationPayload): Promise<void> {
    // Send desktop notification
    await this.sendDesktopNotification(payload);

    // Broadcast to WebSocket clients
    this.broadcast(payload);
  }
}
