import { describe, it, expect, vi, beforeEach } from "vitest";
import { SkillExecutor, type ExecutorDependencies } from "./executor.js";
import type { Skill, Event } from "@clawback/shared";
import type { RunRepository, NotificationRepository, McpServerRepository } from "@clawback/db";

// Mock Anthropic SDK
vi.mock("@anthropic-ai/sdk", () => {
  const mockCreate = vi.fn();
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: mockCreate },
    })),
    __mockCreate: mockCreate,
  };
});

// Mock MCP SDK
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [] }),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "result" }] }),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({})),
}));

describe("SkillExecutor", () => {
  let executor: SkillExecutor;
  let mockRunRepo: Partial<RunRepository>;
  let mockNotifRepo: Partial<NotificationRepository>;
  let mockMcpServerRepo: Partial<McpServerRepository>;
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

    mockDeps = {
      runRepo: mockRunRepo as RunRepository,
      notifRepo: mockNotifRepo as NotificationRepository,
      mcpServerRepo: mockMcpServerRepo as McpServerRepository,
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

  describe("runAgentLoop", () => {
    it("should return early when no API key is configured", async () => {
      const noKeyExecutor = new SkillExecutor({ ...mockDeps, anthropicApiKey: undefined });
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

      const result = await noKeyExecutor.runAgentLoop(testSkill, testEvent, run);

      expect(result.output).toEqual({ message: "No API key configured" });
      expect(result.toolCalls).toEqual([]);
    });

    it("should call Anthropic API with correct model and return response", async () => {
      // Get the mock create function
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { __mockCreate: mockCreate } = (await import("@anthropic-ai/sdk")) as any;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "Hello from Claude" }],
        stop_reason: "end_turn",
      });

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
    });
  });

  describe("model selection", () => {
    it("should use correct model ID for haiku", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { __mockCreate: mockCreate } = (await import("@anthropic-ai/sdk")) as any;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "Hello" }],
        stop_reason: "end_turn",
      });

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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      expect(mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0].model).toBe(
        "claude-haiku-4-5-20251001"
      );
    });

    it("should use correct model ID for sonnet", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { __mockCreate: mockCreate } = (await import("@anthropic-ai/sdk")) as any;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "Hello" }],
        stop_reason: "end_turn",
      });

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

      await executor.runAgentLoop(
        { ...testSkill, model: "sonnet", mcpServers: {} },
        testEvent,
        run
      );

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      expect(mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0].model).toBe(
        "claude-sonnet-4-20250514"
      );
    });

    it("should use correct model ID for opus", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { __mockCreate: mockCreate } = (await import("@anthropic-ai/sdk")) as any;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "Hello" }],
        stop_reason: "end_turn",
      });

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

      await executor.runAgentLoop({ ...testSkill, model: "opus", mcpServers: {} }, testEvent, run);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      expect(mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0].model).toBe(
        "claude-opus-4-20250514"
      );
    });

    it("should default to sonnet when no model specified", async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { __mockCreate: mockCreate } = (await import("@anthropic-ai/sdk")) as any;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "Hello" }],
        stop_reason: "end_turn",
      });

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

      // testSkill doesn't have model set, so it should default to sonnet
      await executor.runAgentLoop({ ...testSkill, mcpServers: {} }, testEvent, run);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      expect(mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0].model).toBe(
        "claude-sonnet-4-20250514"
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
