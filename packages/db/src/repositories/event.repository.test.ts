import { describe, it, expect, beforeEach } from "vitest";
import { EventRepository } from "./event.repository.js";
import { createTestConnection, type DatabaseConnection } from "../connection.js";

describe("EventRepository", () => {
  let db: DatabaseConnection;
  let repo: EventRepository;

  beforeEach(() => {
    db = createTestConnection();
    repo = new EventRepository(db);
  });

  describe("create", () => {
    it("should create an event and return it with generated id", async () => {
      const event = await repo.create({
        source: "github",
        type: "push",
        payload: { ref: "refs/heads/main" },
        metadata: { delivery: "abc123" },
      });

      expect(event.id).toMatch(/^evt_/);
      expect(event.source).toBe("github");
      expect(event.type).toBe("push");
      expect(event.status).toBe("pending");
    });
  });

  describe("findById", () => {
    it("should find an event by id", async () => {
      const created = await repo.create({
        source: "github",
        type: "push",
        payload: {},
        metadata: {},
      });

      const found = await repo.findById(created.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
    });

    it("should return undefined for non-existent id", async () => {
      const found = await repo.findById("evt_nonexistent");
      expect(found).toBeUndefined();
    });
  });

  describe("findPending", () => {
    it("should return only pending events", async () => {
      await repo.create({ source: "test", type: "a", payload: {}, metadata: {} });
      await repo.create({ source: "test", type: "b", payload: {}, metadata: {} });

      const pending = await repo.findPending();
      expect(pending).toHaveLength(2);
      expect(pending.every((e) => e.status === "pending")).toBe(true);
    });
  });

  describe("updateStatus", () => {
    it("should update event status", async () => {
      const event = await repo.create({
        source: "test",
        type: "test",
        payload: {},
        metadata: {},
      });

      await repo.updateStatus(event.id, "completed");
      const updated = await repo.findById(event.id);

      expect(updated?.status).toBe("completed");
    });
  });

  describe("list", () => {
    it("should list events with pagination", async () => {
      for (let i = 0; i < 5; i++) {
        await repo.create({ source: "test", type: `type_${i}`, payload: {}, metadata: {} });
      }

      const page1 = await repo.list({ limit: 2, offset: 0 });
      const page2 = await repo.list({ limit: 2, offset: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
    });

    it("should filter by source", async () => {
      await repo.create({ source: "github", type: "push", payload: {}, metadata: {} });
      await repo.create({ source: "slack", type: "message", payload: {}, metadata: {} });

      const githubEvents = await repo.list({ source: "github" });
      expect(githubEvents).toHaveLength(1);
      expect(githubEvents[0]?.source).toBe("github");
    });
  });
});
