import { describe, it, expect, beforeEach } from "vitest";
import { createTestConnection, type DatabaseConnection } from "../connection.js";
import { WorkflowRepository } from "./workflow.repository.js";
import { EventRepository } from "./event.repository.js";

describe("WorkflowRepository", () => {
  let db: DatabaseConnection;
  let repo: WorkflowRepository;
  let eventRepo: EventRepository;

  beforeEach(() => {
    db = createTestConnection();
    repo = new WorkflowRepository(db);
    eventRepo = new EventRepository(db);
  });

  describe("create", () => {
    it("creates a workflow", () => {
      const workflow = repo.create({
        name: "Test Workflow",
        description: "A test workflow",
        instructions: "Do the things",
        triggers: [{ source: "github", events: ["push"] }],
        skills: ["skill_1", "skill_2"],
      });

      expect(workflow.id).toMatch(/^wf_/);
      expect(workflow.name).toBe("Test Workflow");
      expect(workflow.description).toBe("A test workflow");
      expect(workflow.instructions).toBe("Do the things");
      expect(workflow.triggers).toHaveLength(1);
      expect(workflow.skills).toEqual(["skill_1", "skill_2"]);
      expect(workflow.orchestratorModel).toBe("opus");
      expect(workflow.enabled).toBe(true);
    });

    it("generates unique ID", () => {
      const workflow1 = repo.create({
        name: "Workflow 1",
        instructions: "Instructions",
        triggers: [],
        skills: [],
      });

      const workflow2 = repo.create({
        name: "Workflow 2",
        instructions: "Instructions",
        triggers: [],
        skills: [],
      });

      expect(workflow1.id).not.toBe(workflow2.id);
    });

    it("respects orchestratorModel setting", () => {
      const workflow = repo.create({
        name: "Sonnet Workflow",
        instructions: "Instructions",
        triggers: [],
        skills: [],
        orchestratorModel: "sonnet",
      });

      expect(workflow.orchestratorModel).toBe("sonnet");
    });
  });

  describe("findById", () => {
    it("finds existing workflow", () => {
      const created = repo.create({
        name: "Find Me",
        instructions: "Instructions",
        triggers: [],
        skills: [],
      });

      const found = repo.findById(created.id);
      expect(found).toBeDefined();
      expect(found?.name).toBe("Find Me");
    });

    it("returns undefined for non-existent workflow", () => {
      const found = repo.findById("wf_nonexistent");
      expect(found).toBeUndefined();
    });
  });

  describe("findAll", () => {
    it("returns all enabled workflows by default", () => {
      repo.create({
        name: "Enabled 1",
        instructions: "Instructions",
        triggers: [],
        skills: [],
        enabled: true,
      });

      repo.create({
        name: "Enabled 2",
        instructions: "Instructions",
        triggers: [],
        skills: [],
        enabled: true,
      });

      const disabled = repo.create({
        name: "Disabled",
        instructions: "Instructions",
        triggers: [],
        skills: [],
      });
      repo.setEnabled(disabled.id, false);

      const workflows = repo.findAll(true);
      expect(workflows).toHaveLength(2);
    });

    it("returns all workflows when enabledOnly is false", () => {
      repo.create({
        name: "Enabled",
        instructions: "Instructions",
        triggers: [],
        skills: [],
      });

      const disabled = repo.create({
        name: "Disabled",
        instructions: "Instructions",
        triggers: [],
        skills: [],
      });
      repo.setEnabled(disabled.id, false);

      const workflows = repo.findAll(false);
      expect(workflows).toHaveLength(2);
    });
  });

  describe("update", () => {
    it("updates workflow fields", () => {
      const created = repo.create({
        name: "Original",
        instructions: "Original instructions",
        triggers: [],
        skills: [],
      });

      const updated = repo.update(created.id, {
        name: "Updated",
        instructions: "Updated instructions",
        skills: ["skill_new"],
      });

      expect(updated?.name).toBe("Updated");
      expect(updated?.instructions).toBe("Updated instructions");
      expect(updated?.skills).toEqual(["skill_new"]);
    });

    it("returns undefined for non-existent workflow", () => {
      const updated = repo.update("wf_nonexistent", { name: "New Name" });
      expect(updated).toBeUndefined();
    });
  });

  describe("delete", () => {
    it("deletes existing workflow", () => {
      const created = repo.create({
        name: "To Delete",
        instructions: "Instructions",
        triggers: [],
        skills: [],
      });

      const deleted = repo.delete(created.id);
      expect(deleted).toBe(true);

      const found = repo.findById(created.id);
      expect(found).toBeUndefined();
    });

    it("returns false for non-existent workflow", () => {
      const deleted = repo.delete("wf_nonexistent");
      expect(deleted).toBe(false);
    });
  });

  describe("workflow runs", () => {
    it("creates and finds workflow run", async () => {
      const workflow = repo.create({
        name: "Test Workflow",
        instructions: "Instructions",
        triggers: [],
        skills: [],
      });

      const event = await eventRepo.create({
        source: "github",
        type: "push",
        payload: { test: true },
        metadata: {},
      });

      const run = repo.createRun({
        workflowId: workflow.id,
        eventId: event.id,
        input: { data: "test" },
      });

      expect(run.id).toMatch(/^wfrun_/);
      expect(run.workflowId).toBe(workflow.id);
      expect(run.eventId).toBe(event.id);
      expect(run.status).toBe("pending");
      expect(run.input).toEqual({ data: "test" });

      const found = repo.findRunById(run.id);
      expect(found).toBeDefined();
      expect(found?.id).toBe(run.id);
    });

    it("finds runs by workflow ID", async () => {
      const workflow = repo.create({
        name: "Test Workflow",
        instructions: "Instructions",
        triggers: [],
        skills: [],
      });

      const event = await eventRepo.create({
        source: "github",
        type: "push",
        payload: {},
        metadata: {},
      });

      repo.createRun({ workflowId: workflow.id, eventId: event.id, input: {} });
      repo.createRun({ workflowId: workflow.id, eventId: event.id, input: {} });

      const runs = repo.findRunsByWorkflowId(workflow.id);
      expect(runs).toHaveLength(2);
    });

    it("updates run status", async () => {
      const workflow = repo.create({
        name: "Test Workflow",
        instructions: "Instructions",
        triggers: [],
        skills: [],
      });

      const event = await eventRepo.create({
        source: "github",
        type: "push",
        payload: {},
        metadata: {},
      });

      const run = repo.createRun({
        workflowId: workflow.id,
        eventId: event.id,
        input: {},
      });

      // Update to running
      const running = repo.updateRunStatus(run.id, "running");
      expect(running?.status).toBe("running");
      expect(running?.startedAt).toBeDefined();

      // Update to completed
      const completed = repo.updateRunStatus(run.id, "completed", {
        output: { result: "success" },
      });
      expect(completed?.status).toBe("completed");
      expect(completed?.completedAt).toBeDefined();
      expect(completed?.output).toEqual({ result: "success" });
    });

    it("adds skill runs to workflow run", async () => {
      const workflow = repo.create({
        name: "Test Workflow",
        instructions: "Instructions",
        triggers: [],
        skills: [],
      });

      const event = await eventRepo.create({
        source: "github",
        type: "push",
        payload: {},
        metadata: {},
      });

      const run = repo.createRun({
        workflowId: workflow.id,
        eventId: event.id,
        input: {},
      });

      repo.addSkillRun(run.id, "run_1");
      repo.addSkillRun(run.id, "run_2");

      const updated = repo.findRunById(run.id);
      expect(updated?.skillRuns).toEqual(["run_1", "run_2"]);
    });
  });
});
