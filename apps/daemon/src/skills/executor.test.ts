import { describe, it, expect, vi, beforeEach } from "vitest";
import { SkillExecutor, type ExecutorDependencies } from "./executor.js";
import type { Skill, Event } from "@clawback/shared";
import type { RunRepository, NotificationRepository } from "@clawback/db";

describe("SkillExecutor", () => {
  let executor: SkillExecutor;
  let mockRunRepo: Partial<RunRepository>;
  let mockNotifRepo: Partial<NotificationRepository>;
  let mockDeps: ExecutorDependencies;

  const testSkill: Skill = {
    id: "test-skill",
    name: "Test Skill",
    instructions: "Do something useful",
    triggers: [{ source: "test", events: ["test.event"] }],
    mcpServers: {},
    toolPermissions: { allow: ["*"], deny: [] },
    notifications: { onComplete: true, onError: true },
  };

  const testEvent: Event = {
    id: "evt_123",
    source: "test",
    type: "test.event",
    payload: JSON.stringify({ data: "test" }),
    metadata: JSON.stringify({}),
    status: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  beforeEach(() => {
    mockRunRepo = {
      create: vi.fn().mockResolvedValue({
        id: "run_123",
        eventId: "evt_123",
        skillId: "test-skill",
        status: "pending",
        input: "{}",
        output: null,
        error: null,
        toolCalls: "[]",
        startedAt: null,
        completedAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }),
      updateStatus: vi.fn().mockResolvedValue(undefined),
      addToolCall: vi.fn().mockResolvedValue(undefined),
    };

    mockNotifRepo = {
      create: vi.fn().mockResolvedValue({
        id: "notif_123",
        runId: "run_123",
        skillId: "test-skill",
        type: "success",
        title: "Test",
        message: "Test",
        read: false,
        createdAt: Date.now(),
      }),
    };

    mockDeps = {
      runRepo: mockRunRepo as RunRepository,
      notifRepo: mockNotifRepo as NotificationRepository,
      anthropicApiKey: "test-api-key",
    };

    executor = new SkillExecutor(mockDeps);
  });

  describe("execute", () => {
    it("should create a run record when starting execution", async () => {
      // Mock the Claude API call to return immediately
      vi.spyOn(executor as any, "runAgentLoop").mockResolvedValue({
        output: { message: "Done" },
        toolCalls: [],
      });

      await executor.execute(testSkill, testEvent);

      expect(mockRunRepo.create).toHaveBeenCalledWith({
        eventId: testEvent.id,
        skillId: testSkill.id,
        input: expect.any(Object),
      });
    });

    it("should update run status to running", async () => {
      vi.spyOn(executor as any, "runAgentLoop").mockResolvedValue({
        output: { message: "Done" },
        toolCalls: [],
      });

      await executor.execute(testSkill, testEvent);

      expect(mockRunRepo.updateStatus).toHaveBeenCalledWith("run_123", "running");
    });

    it("should update run status to completed on success", async () => {
      vi.spyOn(executor as any, "runAgentLoop").mockResolvedValue({
        output: { message: "Done" },
        toolCalls: [],
      });

      await executor.execute(testSkill, testEvent);

      expect(mockRunRepo.updateStatus).toHaveBeenCalledWith(
        "run_123",
        "completed",
        expect.any(Object),
        undefined
      );
    });

    it("should update run status to failed on error", async () => {
      vi.spyOn(executor as any, "runAgentLoop").mockRejectedValue(new Error("Test error"));

      await expect(executor.execute(testSkill, testEvent)).rejects.toThrow("Test error");

      expect(mockRunRepo.updateStatus).toHaveBeenCalledWith(
        "run_123",
        "failed",
        undefined,
        "Test error"
      );
    });

    it("should create a notification on completion if configured", async () => {
      vi.spyOn(executor as any, "runAgentLoop").mockResolvedValue({
        output: { message: "Done" },
        toolCalls: [],
      });

      await executor.execute(testSkill, testEvent);

      expect(mockNotifRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          runId: "run_123",
          skillId: "test-skill",
          type: "success",
        })
      );
    });
  });

  describe("buildSystemPrompt", () => {
    it("should include skill instructions", () => {
      const prompt = executor.buildSystemPrompt(testSkill, testEvent);
      expect(prompt).toContain(testSkill.instructions);
    });

    it("should include event context", () => {
      const prompt = executor.buildSystemPrompt(testSkill, testEvent);
      expect(prompt).toContain("test.event");
      expect(prompt).toContain("test");
    });
  });
});
