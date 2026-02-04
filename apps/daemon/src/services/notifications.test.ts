/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NotificationService, type NotificationPayload } from "./notifications.js";

// Mock node-notifier
vi.mock("node-notifier", () => ({
  default: {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    notify: vi.fn((options, callback: (err: Error | null, response: string) => void) => {
      if (callback) callback(null, "clicked");
    }),
  },
}));

describe("NotificationService", () => {
  let service: NotificationService;

  beforeEach(() => {
    service = new NotificationService({ enableDesktop: true });
    vi.clearAllMocks();
  });

  afterEach(() => {
    service.closeAllConnections();
  });

  describe("desktop notifications", () => {
    it("should send desktop notification with correct options", async () => {
      const notifier = await import("node-notifier");

      const payload: NotificationPayload = {
        id: "notif_123",
        type: "success",
        title: "Task Complete",
        message: "Your skill finished running",
        skillId: "skill_1",
        runId: "run_1",
      };

      await service.sendDesktopNotification(payload);

      const notifyFn = notifier.default.notify;
      expect(notifyFn).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Task Complete",
          message: "Your skill finished running",
        }),
        expect.any(Function)
      );
    });

    it("should handle desktop notification errors gracefully", async () => {
      const notifier = await import("node-notifier");
      const notifyMock = vi.mocked(notifier.default.notify);
      notifyMock.mockImplementation((options, callback) => {
        if (callback) callback(new Error("Desktop notification failed"), "");
        return notifier.default;
      });

      const payload: NotificationPayload = {
        id: "notif_123",
        type: "error",
        title: "Error",
        message: "Something went wrong",
      };

      // Should not throw
      await expect(service.sendDesktopNotification(payload)).resolves.not.toThrow();
    });

    it("should not send desktop notifications when disabled", async () => {
      const notifier = await import("node-notifier");
      const disabledService = new NotificationService({ enableDesktop: false });

      const payload: NotificationPayload = {
        id: "notif_123",
        type: "info",
        title: "Test",
        message: "Test message",
      };

      await disabledService.sendDesktopNotification(payload);

      const notifyFn = notifier.default.notify;
      expect(notifyFn).not.toHaveBeenCalled();
    });
  });

  describe("WebSocket connections", () => {
    it("should track connected clients", () => {
      const mockSocket1 = { send: vi.fn(), readyState: 1 };
      const mockSocket2 = { send: vi.fn(), readyState: 1 };

      service.addConnection("client1", mockSocket1 as unknown as WebSocket);
      service.addConnection("client2", mockSocket2 as unknown as WebSocket);

      expect(service.getConnectionCount()).toBe(2);
    });

    it("should remove disconnected clients", () => {
      const mockSocket = { send: vi.fn(), readyState: 1 };

      service.addConnection("client1", mockSocket as unknown as WebSocket);
      expect(service.getConnectionCount()).toBe(1);

      service.removeConnection("client1");
      expect(service.getConnectionCount()).toBe(0);
    });

    it("should broadcast to all connected clients", () => {
      const mockSocket1 = { send: vi.fn(), readyState: 1 };
      const mockSocket2 = { send: vi.fn(), readyState: 1 };

      service.addConnection("client1", mockSocket1 as unknown as WebSocket);
      service.addConnection("client2", mockSocket2 as unknown as WebSocket);

      const payload: NotificationPayload = {
        id: "notif_123",
        type: "success",
        title: "Broadcast",
        message: "Hello all",
      };

      service.broadcast(payload);

      expect(mockSocket1.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "notification", notification: payload })
      );
      expect(mockSocket2.send).toHaveBeenCalledWith(
        JSON.stringify({ type: "notification", notification: payload })
      );
    });

    it("should skip clients with closed connections", () => {
      const openSocket = { send: vi.fn(), readyState: 1 }; // OPEN
      const closedSocket = { send: vi.fn(), readyState: 3 }; // CLOSED

      service.addConnection("open", openSocket as unknown as WebSocket);
      service.addConnection("closed", closedSocket as unknown as WebSocket);

      const payload: NotificationPayload = {
        id: "notif_123",
        type: "info",
        title: "Test",
        message: "Test",
      };

      service.broadcast(payload);

      expect(openSocket.send).toHaveBeenCalled();
      expect(closedSocket.send).not.toHaveBeenCalled();
    });
  });

  describe("notify", () => {
    it("should send both desktop and WebSocket notifications", async () => {
      const notifier = await import("node-notifier");
      const mockSocket = { send: vi.fn(), readyState: 1 };

      service.addConnection("client1", mockSocket as unknown as WebSocket);

      const payload: NotificationPayload = {
        id: "notif_123",
        type: "success",
        title: "Complete",
        message: "Done!",
      };

      await service.notify(payload);

      const notifyFn = notifier.default.notify;
      expect(notifyFn).toHaveBeenCalled();
      expect(mockSocket.send).toHaveBeenCalled();
    });
  });
});
