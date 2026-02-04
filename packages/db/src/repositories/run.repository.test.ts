import { describe, it, expect, beforeEach } from "vitest";
import { RunRepository } from "./run.repository.js";
import { EventRepository } from "./event.repository.js";
import { createTestConnection, type DatabaseConnection } from "../connection.js";

describe("RunRepository", () => {
  let db: DatabaseConnection;
  let runRepo: RunRepository;
  let eventRepo: EventRepository;
  let testEventId: string;

  beforeEach(async () => {
    db = createTestConnection();
    runRepo = new RunRepository(db);
    eventRepo = new EventRepository(db);

    // Create a test event for runs to reference
    const event = await eventRepo.create({
      source: "test",
      type: "test",
      payload: {},
      metadata: {},
    });
    testEventId = event.id;
  });

  describe("create", () => {
    it("should create a run and return it", async () => {
      const run = await runRepo.create({
        eventId: testEventId,
        skillId: "test-skill",
        input: { test: true },
      });

      expect(run.id).toMatch(/^run_/);
      expect(run.eventId).toBe(testEventId);
      expect(run.skillId).toBe("test-skill");
      expect(run.status).toBe("pending");
    });
  });

  describe("findById", () => {
    it("should find a run by id", async () => {
      const created = await runRepo.create({
        eventId: testEventId,
        skillId: "test-skill",
        input: {},
      });

      const found = await runRepo.findById(created.id);
      expect(found?.id).toBe(created.id);
    });
  });

  describe("updateStatus", () => {
    it("should update run status to running", async () => {
      const run = await runRepo.create({
        eventId: testEventId,
        skillId: "test-skill",
        input: {},
      });

      await runRepo.updateStatus(run.id, "running");
      const updated = await runRepo.findById(run.id);

      expect(updated?.status).toBe("running");
      expect(updated?.startedAt).toBeDefined();
    });

    it("should update run status to completed with output", async () => {
      const run = await runRepo.create({
        eventId: testEventId,
        skillId: "test-skill",
        input: {},
      });

      await runRepo.updateStatus(run.id, "completed", { result: "success" });
      const updated = await runRepo.findById(run.id);

      expect(updated?.status).toBe("completed");
      expect(updated?.completedAt).toBeDefined();
    });

    it("should update run status to failed with error", async () => {
      const run = await runRepo.create({
        eventId: testEventId,
        skillId: "test-skill",
        input: {},
      });

      await runRepo.updateStatus(run.id, "failed", undefined, "Something went wrong");
      const updated = await runRepo.findById(run.id);

      expect(updated?.status).toBe("failed");
      expect(updated?.error).toBe("Something went wrong");
    });
  });

  describe("addToolCall", () => {
    it("should add a tool call to a run", async () => {
      const run = await runRepo.create({
        eventId: testEventId,
        skillId: "test-skill",
        input: {},
      });

      await runRepo.addToolCall(run.id, {
        id: "tc_123",
        name: "test_tool",
        input: { arg: "value" },
        output: { result: "ok" },
        error: null,
        startedAt: new Date(),
        completedAt: new Date(),
      });

      const updated = await runRepo.findById(run.id);
      const toolCalls = JSON.parse(updated?.toolCalls ?? "[]");
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].name).toBe("test_tool");
    });
  });

  describe("findByEvent", () => {
    it("should find all runs for an event", async () => {
      await runRepo.create({ eventId: testEventId, skillId: "skill-1", input: {} });
      await runRepo.create({ eventId: testEventId, skillId: "skill-2", input: {} });

      const runs = await runRepo.findByEvent(testEventId);
      expect(runs).toHaveLength(2);
    });
  });

  describe("list", () => {
    it("should list runs with pagination", async () => {
      for (let i = 0; i < 5; i++) {
        await runRepo.create({ eventId: testEventId, skillId: `skill-${i}`, input: {} });
      }

      const page1 = await runRepo.list({ limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);
    });

    it("should filter by skillId", async () => {
      await runRepo.create({ eventId: testEventId, skillId: "skill-a", input: {} });
      await runRepo.create({ eventId: testEventId, skillId: "skill-b", input: {} });

      const filtered = await runRepo.list({ skillId: "skill-a" });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.skillId).toBe("skill-a");
    });
  });
});
