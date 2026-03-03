import { describe, it, expect, vi, beforeEach } from "vitest";
import { SkillExecutor, type ExecutorDependencies } from "./executor.js";
import type { Skill, Event } from "@clawback/shared";
import type { RunRepository, NotificationRepository, McpServerRepository } from "@clawback/db";
import type { AiEngine, LoopConfig, LoopResult } from "../ai/types.js";

function createMockEngine(overrides?: Partial<AiEngine>): AiEngine {
  return {
    runLoop: vi.fn().mockResolvedValue({
      finalText: "Hello from Claude",
      messages: [],
    } satisfies LoopResult),
    ...overrides,
  };
}

describe("SkillExecutor", () => {
  let executor: SkillExecutor;
  let mockRunRepo: Partial<RunRepository>;
  let mockNotifRepo: Partial<NotificationRepository>;
  let mockMcpServerRepo: Partial<McpServerRepository>;
  let mockEngine: AiEngine;
  let mockDeps: ExecutorDependencies;

  const testSkill: Skill = {
    id: "test-skill",
    name: "Test Skill",
    instructions: "Do something useful",
    triggers: [{ source: "test", events: ["test.event"] }],
    mcpServers: {},
    toolPermissions: { allow: ["*"], deny: [] },
    notifications: { onComplete: true, onError: true },
    isRemote: false,
  };

  const testEvent: Event = {
    id: "evt_123",
    source: "test",
    type: "test.event",
    payload: { data: "test" },
    metadata: {},
    status: "pending",
    createdAt: new Date(),
    updatedAt: new Date(),
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

    mockMcpServerRepo = {
      findByName: vi.fn().mockReturnValue(null),
      findAll: vi.fn().mockReturnValue([]),
    };

    mockEngine = createMockEngine();

    mockDeps = {
      runRepo: mockRunRepo as RunRepository,
      notifRepo: mockNotifRepo as NotificationRepository,
      mcpServerRepo: mockMcpServerRepo as McpServerRepository,
      engine: mockEngine,
    };

    executor = new SkillExecutor(mockDeps);
  });

  describe("execute", () => {
    it("should create a run record when starting execution", async () => {
      await executor.execute(testSkill, testEvent);

      expect(mockRunRepo.create).toHaveBeenCalledWith({
        eventId: testEvent.id,
        skillId: testSkill.id,
        input: expect.any(Object),
      });
    });

    it("should update run status to running", async () => {
      await executor.execute(testSkill, testEvent);

      expect(mockRunRepo.updateStatus).toHaveBeenCalledWith("run_123", "running");
    });

    it("should update run status to completed on success", async () => {
      await executor.execute(testSkill, testEvent);

      expect(mockRunRepo.updateStatus).toHaveBeenCalledWith(
        "run_123",
        "completed",
        expect.any(Object),
        undefined
      );
    });

    it("should update run status to failed on error", async () => {
      mockEngine.runLoop = vi.fn().mockRejectedValue(new Error("Test error"));

      await expect(executor.execute(testSkill, testEvent)).rejects.toThrow("Test error");

      expect(mockRunRepo.updateStatus).toHaveBeenCalledWith(
        "run_123",
        "failed",
        undefined,
        "Test error"
      );
    });

    it("should create a notification on completion if configured", async () => {
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

  describe("runAgentLoop", () => {
    it("should return early when no engine is configured", async () => {
      const noEngineExecutor = new SkillExecutor({ ...mockDeps, engine: undefined });
      const run = {
        id: "run_1",
        eventId: "e1",
        skillId: "s1",
        status: "running" as const,
        input: "{}",
        output: null,
        error: null,
        toolCalls: "[]",
        startedAt: null,
        completedAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const result = await noEngineExecutor.runAgentLoop(testSkill, testEvent, run);

      expect(result.output).toEqual({ message: "No AI engine configured" });
      expect(result.toolCalls).toEqual([]);
    });

    it("should call engine.runLoop and return response", async () => {
      const run = {
        id: "run_1",
        eventId: "e1",
        skillId: "s1",
        status: "running" as const,
        input: "{}",
        output: null,
        error: null,
        toolCalls: "[]",
        startedAt: null,
        completedAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      const result = await executor.runAgentLoop({ ...testSkill, mcpServers: {} }, testEvent, run);

      expect(result.output).toEqual({ response: "Hello from Claude" });
      expect(result.toolCalls).toEqual([]);
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockEngine.runLoop).toHaveBeenCalledTimes(1);
    });

    it("should pass the correct model ID to the engine", async () => {
      const run = {
        id: "run_1",
        eventId: "e1",
        skillId: "s1",
        status: "running" as const,
        input: "{}",
        output: null,
        error: null,
        toolCalls: "[]",
        startedAt: null,
        completedAt: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await executor.runAgentLoop({ ...testSkill, model: "haiku", mcpServers: {} }, testEvent, run);

      const callArgs = (mockEngine.runLoop as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as LoopConfig;
      expect(callArgs.model).toBe("claude-haiku-4-5-20251001");
    });
  });

  describe("model selection", () => {
    const run = {
      id: "run_1",
      eventId: "e1",
      skillId: "s1",
      status: "running" as const,
      input: "{}",
      output: null,
      error: null,
      toolCalls: "[]",
      startedAt: null,
      completedAt: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    it("should use correct model ID for haiku", async () => {
      await executor.runAgentLoop({ ...testSkill, model: "haiku", mcpServers: {} }, testEvent, run);
      const callArgs = (mockEngine.runLoop as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as LoopConfig;
      expect(callArgs.model).toBe("claude-haiku-4-5-20251001");
    });

    it("should use correct model ID for sonnet", async () => {
      await executor.runAgentLoop(
        { ...testSkill, model: "sonnet", mcpServers: {} },
        testEvent,
        run
      );
      const callArgs = (mockEngine.runLoop as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as LoopConfig;
      expect(callArgs.model).toBe("claude-sonnet-4-20250514");
    });

    it("should use correct model ID for opus", async () => {
      await executor.runAgentLoop({ ...testSkill, model: "opus", mcpServers: {} }, testEvent, run);
      const callArgs = (mockEngine.runLoop as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as LoopConfig;
      expect(callArgs.model).toBe("claude-opus-4-20250514");
    });

    it("should default to sonnet when no model specified", async () => {
      await executor.runAgentLoop({ ...testSkill, mcpServers: {} }, testEvent, run);
      const callArgs = (mockEngine.runLoop as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as LoopConfig;
      expect(callArgs.model).toBe("claude-sonnet-4-20250514");
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
