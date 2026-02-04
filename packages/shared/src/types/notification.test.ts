import { describe, it, expect } from "vitest";
import { NotificationSchema, NotificationTypeSchema, type Notification } from "./notification.js";

describe("Notification", () => {
  it("should validate a valid notification", () => {
    const notification: Notification = {
      id: "notif_123",
      runId: "run_456",
      skillId: "github-pr-reviewer",
      type: "success",
      title: "PR Review Complete",
      message: "Successfully reviewed PR #42",
      read: false,
      createdAt: new Date(),
    };

    const result = NotificationSchema.safeParse(notification);
    expect(result.success).toBe(true);
  });

  it("should validate all notification types", () => {
    const types = ["success", "error", "info", "warning"];
    for (const type of types) {
      const result = NotificationTypeSchema.safeParse(type);
      expect(result.success).toBe(true);
    }
  });

  it("should reject invalid type", () => {
    const result = NotificationTypeSchema.safeParse("critical");
    expect(result.success).toBe(false);
  });

  it("should default read to false", () => {
    const notification = {
      id: "notif_123",
      runId: "run_456",
      skillId: "github-pr-reviewer",
      type: "info",
      title: "Test",
      message: "Test message",
      createdAt: new Date(),
    };

    const result = NotificationSchema.parse(notification);
    expect(result.read).toBe(false);
  });
});
