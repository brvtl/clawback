import { describe, it, expect, beforeEach } from "vitest";
import { CheckpointRepository } from "./checkpoint.repository.js";
import { EventRepository } from "./event.repository.js";
import { RunRepository } from "./run.repository.js";
import { WorkflowRepository } from "./workflow.repository.js";
import { createTestConnection, type DatabaseConnection } from "../connection.js";

describe("CheckpointRepository", () => {
  let db: DatabaseConnection;
  let repo: CheckpointRepository;
  let testRunId: string;
  let testRunId2: string;
  let testWorkflowRunId: string;

  beforeEach(async () => {
    db = createTestConnection();
    repo = new CheckpointRepository(db);

    // Build FK chain: event -> run, event -> workflow -> workflow_run
    const eventRepo = new EventRepository(db);
    const runRepo = new RunRepository(db);
    const workflowRepo = new WorkflowRepository(db);

    const event = await eventRepo.create({
      source: "test",
      type: "test.event",
      payload: {},
      metadata: {},
    });

    const run = await runRepo.create({
      eventId: event.id,
      skillId: "skill_test1",
      input: {},
    });
    testRunId = run.id;

    const run2 = await runRepo.create({
      eventId: event.id,
      skillId: "skill_test2",
      input: {},
    });
    testRunId2 = run2.id;

    const workflow = workflowRepo.create({
      name: "Test Workflow",
      instructions: "Test",
      triggers: [],
      skills: [],
    });

    const workflowRun = workflowRepo.createRun({
      workflowId: workflow.id,
      eventId: event.id,
      input: {},
    });
    testWorkflowRunId = workflowRun.id;
  });

  describe("create", () => {
    it("creates a checkpoint with a runId", () => {
      const checkpoint = repo.create({
        runId: testRunId,
        sequence: 0,
        type: "assistant_message",
        data: { content: "hello" },
      });

      expect(checkpoint.id).toMatch(/^cp_/);
      expect(checkpoint.runId).toBe(testRunId);
      expect(checkpoint.workflowRunId).toBeNull();
      expect(checkpoint.sequence).toBe(0);
      expect(checkpoint.type).toBe("assistant_message");
    });

    it("creates a checkpoint with a workflowRunId", () => {
      const checkpoint = repo.create({
        workflowRunId: testWorkflowRunId,
        sequence: 0,
        type: "skill_spawn",
        data: { skillId: "skill_abc" },
      });

      expect(checkpoint.id).toMatch(/^cp_/);
      expect(checkpoint.runId).toBeNull();
      expect(checkpoint.workflowRunId).toBe(testWorkflowRunId);
      expect(checkpoint.type).toBe("skill_spawn");
    });

    it("generates unique IDs for each checkpoint", () => {
      const first = repo.create({
        runId: testRunId,
        sequence: 0,
        type: "assistant_message",
        data: {},
      });

      const second = repo.create({
        runId: testRunId,
        sequence: 1,
        type: "tool_call",
        data: {},
      });

      expect(first.id).not.toBe(second.id);
    });

    it("stores data as a JSON string", () => {
      const payload = { tool: "bash", args: ["ls"] };
      const checkpoint = repo.create({
        runId: testRunId,
        sequence: 0,
        type: "tool_call",
        data: payload,
      });

      expect(checkpoint.data).toBe(JSON.stringify(payload));
    });

    it("stores state as a JSON string when provided", () => {
      const state = { messages: [{ role: "user", content: "hi" }] };
      const checkpoint = repo.create({
        runId: testRunId,
        sequence: 0,
        type: "assistant_message",
        data: {},
        state,
      });

      expect(checkpoint.state).toBe(JSON.stringify(state));
    });

    it("sets state to null when not provided", () => {
      const checkpoint = repo.create({
        runId: testRunId,
        sequence: 0,
        type: "assistant_message",
        data: {},
      });

      expect(checkpoint.state).toBeNull();
    });
  });

  describe("findById", () => {
    it("finds an existing checkpoint by id", () => {
      const created = repo.create({
        runId: testRunId,
        sequence: 0,
        type: "tool_result",
        data: { output: "done" },
      });

      const found = repo.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
      expect(found?.type).toBe("tool_result");
    });

    it("returns undefined for a non-existent id", () => {
      const found = repo.findById("cp_doesnotexist");

      expect(found).toBeUndefined();
    });
  });

  describe("findByRunId", () => {
    it("returns checkpoints ordered by sequence ascending", () => {
      repo.create({ runId: testRunId, sequence: 2, type: "tool_result", data: {} });
      repo.create({ runId: testRunId, sequence: 0, type: "assistant_message", data: {} });
      repo.create({ runId: testRunId, sequence: 1, type: "tool_call", data: {} });

      const results = repo.findByRunId(testRunId);

      expect(results).toHaveLength(3);
      expect(results[0]?.sequence).toBe(0);
      expect(results[1]?.sequence).toBe(1);
      expect(results[2]?.sequence).toBe(2);
    });

    it("returns an empty array when no checkpoints match the runId", () => {
      repo.create({ runId: testRunId, sequence: 0, type: "assistant_message", data: {} });

      const results = repo.findByRunId("run_other");

      expect(results).toHaveLength(0);
    });

    it("only returns checkpoints belonging to the specified runId", () => {
      repo.create({ runId: testRunId, sequence: 0, type: "assistant_message", data: {} });
      repo.create({ runId: testRunId2, sequence: 0, type: "error", data: {} });

      const results = repo.findByRunId(testRunId);

      expect(results).toHaveLength(1);
      expect(results[0]?.runId).toBe(testRunId);
    });
  });

  describe("findByWorkflowRunId", () => {
    it("returns checkpoints ordered by sequence ascending", () => {
      repo.create({
        workflowRunId: testWorkflowRunId,
        sequence: 1,
        type: "skill_complete",
        data: {},
      });
      repo.create({
        workflowRunId: testWorkflowRunId,
        sequence: 0,
        type: "skill_spawn",
        data: {},
      });

      const results = repo.findByWorkflowRunId(testWorkflowRunId);

      expect(results).toHaveLength(2);
      expect(results[0]?.sequence).toBe(0);
      expect(results[0]?.type).toBe("skill_spawn");
      expect(results[1]?.sequence).toBe(1);
      expect(results[1]?.type).toBe("skill_complete");
    });

    it("returns an empty array when no checkpoints match the workflowRunId", () => {
      const results = repo.findByWorkflowRunId("wfrun_nonexistent");

      expect(results).toHaveLength(0);
    });
  });

  describe("getNextSequence", () => {
    it("returns 0 when no checkpoints exist for the runId", () => {
      expect(repo.getNextSequence(testRunId)).toBe(0);
    });

    it("returns 0 when no checkpoints exist for the workflowRunId", () => {
      expect(repo.getNextSequence(undefined, testWorkflowRunId)).toBe(0);
    });

    it("returns 0 when neither runId nor workflowRunId is provided", () => {
      repo.create({ runId: testRunId, sequence: 0, type: "assistant_message", data: {} });

      expect(repo.getNextSequence()).toBe(0);
    });

    it("returns the count of existing checkpoints for a runId", () => {
      repo.create({ runId: testRunId, sequence: 0, type: "assistant_message", data: {} });
      repo.create({ runId: testRunId, sequence: 1, type: "tool_call", data: {} });
      repo.create({ runId: testRunId, sequence: 2, type: "tool_result", data: {} });

      expect(repo.getNextSequence(testRunId)).toBe(3);
    });

    it("returns the count of existing checkpoints for a workflowRunId", () => {
      repo.create({
        workflowRunId: testWorkflowRunId,
        sequence: 0,
        type: "skill_spawn",
        data: {},
      });
      repo.create({
        workflowRunId: testWorkflowRunId,
        sequence: 1,
        type: "skill_complete",
        data: {},
      });

      expect(repo.getNextSequence(undefined, testWorkflowRunId)).toBe(2);
    });
  });
});
