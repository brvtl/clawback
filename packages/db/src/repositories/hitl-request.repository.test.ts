import { describe, it, expect, beforeEach } from "vitest";
import { createTestConnection, type DatabaseConnection } from "../connection.js";
import { HitlRequestRepository } from "./hitl-request.repository.js";
import { WorkflowRepository } from "./workflow.repository.js";
import { CheckpointRepository } from "./checkpoint.repository.js";
import { EventRepository } from "./event.repository.js";

describe("HitlRequestRepository", () => {
  let db: DatabaseConnection;
  let repo: HitlRequestRepository;
  let testWorkflowRunId: string;
  let testCheckpointId: string;

  beforeEach(async () => {
    db = createTestConnection();
    repo = new HitlRequestRepository(db);

    const eventRepo = new EventRepository(db);
    const workflowRepo = new WorkflowRepository(db);
    const checkpointRepo = new CheckpointRepository(db);

    const event = await eventRepo.create({
      source: "test",
      type: "test.event",
      payload: {},
      metadata: {},
    });

    const workflow = workflowRepo.create({
      name: "Test Workflow",
      instructions: "Test instructions",
      triggers: [],
      skills: [],
    });

    const workflowRun = workflowRepo.createRun({
      workflowId: workflow.id,
      eventId: event.id,
      input: {},
    });
    testWorkflowRunId = workflowRun.id;

    const checkpoint = checkpointRepo.create({
      workflowRunId: testWorkflowRunId,
      sequence: 0,
      type: "hitl_request",
      data: { step: "approval" },
    });
    testCheckpointId = checkpoint.id;
  });

  describe("create", () => {
    it("creates with required fields and defaults", () => {
      const request = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Please approve this action",
      });

      expect(request.id).toMatch(/^hitl_/);
      expect(request.workflowRunId).toBe(testWorkflowRunId);
      expect(request.checkpointId).toBe(testCheckpointId);
      expect(request.prompt).toBe("Please approve this action");
      expect(request.status).toBe("pending");
      expect(request.createdAt).toBeTypeOf("number");
    });

    it("generates unique IDs for each request", () => {
      const request1 = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "First prompt",
      });

      const request2 = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Second prompt",
      });

      expect(request1.id).not.toBe(request2.id);
    });

    it("stores context as JSON string", () => {
      const context = { action: "deploy", environment: "production", version: "1.2.3" };
      const request = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Approve deployment",
        context,
      });

      const found = repo.findById(request.id);
      expect(found?.context).toBe(JSON.stringify(context));
    });

    it("stores options as JSON string", () => {
      const options = ["approve", "reject", "defer"];
      const request = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Choose an action",
        options,
      });

      const found = repo.findById(request.id);
      expect(found?.options).toBe(JSON.stringify(options));
    });

    it("sets context to null when not provided", () => {
      const request = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "No context prompt",
      });

      expect(request.context).toBeNull();
    });

    it("sets options to null when not provided", () => {
      const request = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "No options prompt",
      });

      expect(request.options).toBeNull();
    });

    it("sets timeoutAt to null when not provided", () => {
      const request = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "No timeout prompt",
      });

      expect(request.timeoutAt).toBeNull();
    });

    it("stores timeoutAt when provided", () => {
      const timeoutAt = Date.now() + 60_000;
      const request = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Timed prompt",
        timeoutAt,
      });

      expect(request.timeoutAt).toBe(timeoutAt);
    });
  });

  describe("findById", () => {
    it("finds existing request by ID", () => {
      const created = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Find me",
      });

      const found = repo.findById(created.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.prompt).toBe("Find me");
    });

    it("returns undefined for non-existent ID", () => {
      const found = repo.findById("hitl_nonexistent");
      expect(found).toBeUndefined();
    });
  });

  describe("findPending", () => {
    it("returns only pending requests", () => {
      repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Pending one",
      });

      repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Pending two",
      });

      const pending = repo.findPending();
      expect(pending).toHaveLength(2);
      expect(pending.every((r) => r.status === "pending")).toBe(true);
    });

    it("excludes responded requests", () => {
      const request = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Will be responded",
      });

      repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Still pending",
      });

      repo.respond(request.id, "approved");

      const pending = repo.findPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.prompt).toBe("Still pending");
    });

    it("excludes cancelled requests", () => {
      const request = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Will be cancelled",
      });

      repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Still pending",
      });

      repo.cancel(request.id);

      const pending = repo.findPending();
      expect(pending).toHaveLength(1);
      expect(pending[0]?.prompt).toBe("Still pending");
    });
  });

  describe("findByWorkflowRunId", () => {
    it("returns all requests for a given workflow run", async () => {
      const eventRepo = new EventRepository(db);
      const workflowRepo = new WorkflowRepository(db);
      const checkpointRepo = new CheckpointRepository(db);

      const event2 = await eventRepo.create({
        source: "test",
        type: "test.event",
        payload: {},
        metadata: {},
      });

      const workflow2 = workflowRepo.create({
        name: "Second Workflow",
        instructions: "Instructions",
        triggers: [],
        skills: [],
      });

      const workflowRun2 = workflowRepo.createRun({
        workflowId: workflow2.id,
        eventId: event2.id,
        input: {},
      });

      const checkpoint2 = checkpointRepo.create({
        workflowRunId: workflowRun2.id,
        sequence: 0,
        type: "hitl_request",
        data: {},
      });

      repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "First for run 1",
      });

      repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Second for run 1",
      });

      repo.create({
        workflowRunId: workflowRun2.id,
        checkpointId: checkpoint2.id,
        prompt: "For run 2",
      });

      const results = repo.findByWorkflowRunId(testWorkflowRunId);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.workflowRunId === testWorkflowRunId)).toBe(true);
    });

    it("returns empty array when no requests match", () => {
      const results = repo.findByWorkflowRunId("wfrun_no_match");
      expect(results).toHaveLength(0);
    });

    it("returns requests across all statuses for the workflow run", () => {
      const pending = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Pending",
      });

      const toRespond = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Responded",
      });

      const toCancel = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Cancelled",
      });

      repo.respond(toRespond.id, "yes");
      repo.cancel(toCancel.id);

      const results = repo.findByWorkflowRunId(testWorkflowRunId);
      expect(results).toHaveLength(3);
      const ids = results.map((r) => r.id);
      expect(ids).toContain(pending.id);
      expect(ids).toContain(toRespond.id);
      expect(ids).toContain(toCancel.id);
    });
  });

  describe("respond", () => {
    it("updates status to responded and sets response", () => {
      const request = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Approve?",
      });

      const responded = repo.respond(request.id, "approved");

      expect(responded).toBeDefined();
      expect(responded?.status).toBe("responded");
      expect(responded?.response).toBe("approved");
    });

    it("sets respondedAt timestamp on respond", () => {
      const before = Date.now();
      const request = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Approve?",
      });

      const responded = repo.respond(request.id, "approved");
      const after = Date.now();

      expect(responded?.respondedAt).toBeTypeOf("number");
      expect(responded?.respondedAt).toBeGreaterThanOrEqual(before);
      expect(responded?.respondedAt).toBeLessThanOrEqual(after);
    });

    it("returns undefined for non-existent ID", () => {
      const result = repo.respond("hitl_nonexistent", "approved");
      expect(result).toBeUndefined();
    });

    it("returns undefined when request is already responded (non-pending)", () => {
      const request = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Approve?",
      });

      repo.respond(request.id, "first response");
      const secondAttempt = repo.respond(request.id, "second response");

      expect(secondAttempt).toBeUndefined();

      const final = repo.findById(request.id);
      expect(final?.response).toBe("first response");
    });

    it("returns undefined when request is cancelled (non-pending)", () => {
      const request = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Approve?",
      });

      repo.cancel(request.id);
      const result = repo.respond(request.id, "too late");

      expect(result).toBeUndefined();

      const final = repo.findById(request.id);
      expect(final?.status).toBe("cancelled");
      expect(final?.response).toBeNull();
    });
  });

  describe("cancel", () => {
    it("updates status to cancelled", () => {
      const request = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Cancel me",
      });

      const cancelled = repo.cancel(request.id);

      expect(cancelled).toBeDefined();
      expect(cancelled?.status).toBe("cancelled");
    });

    it("returns undefined for non-existent ID", () => {
      const result = repo.cancel("hitl_nonexistent");
      expect(result).toBeUndefined();
    });

    it("returns undefined when request is already responded (non-pending)", () => {
      const request = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Approve?",
      });

      repo.respond(request.id, "approved");
      const result = repo.cancel(request.id);

      expect(result).toBeUndefined();

      const final = repo.findById(request.id);
      expect(final?.status).toBe("responded");
    });

    it("returns undefined when request is already cancelled (non-pending)", () => {
      const request = repo.create({
        workflowRunId: testWorkflowRunId,
        checkpointId: testCheckpointId,
        prompt: "Cancel me",
      });

      repo.cancel(request.id);
      const secondAttempt = repo.cancel(request.id);

      expect(secondAttempt).toBeUndefined();

      const final = repo.findById(request.id);
      expect(final?.status).toBe("cancelled");
    });
  });
});
