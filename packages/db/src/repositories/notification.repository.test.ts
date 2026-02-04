import { describe, it, expect, beforeEach } from "vitest";
import { NotificationRepository } from "./notification.repository.js";
import { RunRepository } from "./run.repository.js";
import { EventRepository } from "./event.repository.js";
import { createTestConnection, type DatabaseConnection } from "../connection.js";

describe("NotificationRepository", () => {
  let db: DatabaseConnection;
  let notifRepo: NotificationRepository;
  let runRepo: RunRepository;
  let eventRepo: EventRepository;
  let testRunId: string;

  beforeEach(async () => {
    db = createTestConnection();
    notifRepo = new NotificationRepository(db);
    runRepo = new RunRepository(db);
    eventRepo = new EventRepository(db);

    // Create test event and run
    const event = await eventRepo.create({
      source: "test",
      type: "test",
      payload: {},
      metadata: {},
    });

    const run = await runRepo.create({
      eventId: event.id,
      skillId: "test-skill",
      input: {},
    });
    testRunId = run.id;
  });

  describe("create", () => {
    it("should create a notification", async () => {
      const notif = await notifRepo.create({
        runId: testRunId,
        skillId: "test-skill",
        type: "success",
        title: "Test Complete",
        message: "Test completed successfully",
      });

      expect(notif.id).toMatch(/^notif_/);
      expect(notif.type).toBe("success");
      expect(notif.read).toBe(false);
    });
  });

  describe("findUnread", () => {
    it("should return only unread notifications", async () => {
      await notifRepo.create({
        runId: testRunId,
        skillId: "test-skill",
        type: "info",
        title: "Test 1",
        message: "Test message",
      });

      const notif2 = await notifRepo.create({
        runId: testRunId,
        skillId: "test-skill",
        type: "info",
        title: "Test 2",
        message: "Test message",
      });

      // Mark one as read
      await notifRepo.markRead(notif2.id);

      const unread = await notifRepo.findUnread();
      expect(unread).toHaveLength(1);
      expect(unread[0]?.title).toBe("Test 1");
    });
  });

  describe("markRead", () => {
    it("should mark a notification as read", async () => {
      const notif = await notifRepo.create({
        runId: testRunId,
        skillId: "test-skill",
        type: "info",
        title: "Test",
        message: "Test message",
      });

      await notifRepo.markRead(notif.id);
      const updated = await notifRepo.findById(notif.id);

      expect(updated?.read).toBe(true);
    });
  });

  describe("markAllRead", () => {
    it("should mark all notifications as read", async () => {
      await notifRepo.create({
        runId: testRunId,
        skillId: "test-skill",
        type: "info",
        title: "Test 1",
        message: "Test",
      });

      await notifRepo.create({
        runId: testRunId,
        skillId: "test-skill",
        type: "info",
        title: "Test 2",
        message: "Test",
      });

      await notifRepo.markAllRead();

      const unread = await notifRepo.findUnread();
      expect(unread).toHaveLength(0);
    });
  });

  describe("list", () => {
    it("should list notifications with pagination", async () => {
      for (let i = 0; i < 5; i++) {
        await notifRepo.create({
          runId: testRunId,
          skillId: "test-skill",
          type: "info",
          title: `Test ${i}`,
          message: "Test",
        });
      }

      const page1 = await notifRepo.list({ limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);
    });
  });
});
