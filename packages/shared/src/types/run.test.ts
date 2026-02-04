import { describe, it, expect } from "vitest";
import { RunSchema, RunStatusSchema, ToolCallSchema, type Run } from "./run.js";

describe("Run", () => {
  it("should validate a valid run", () => {
    const run: Run = {
      id: "run_123",
      eventId: "evt_456",
      skillId: "github-pr-reviewer",
      parentRunId: null,
      status: "running",
      input: { pr_number: 42 },
      output: null,
      error: null,
      toolCalls: [
        {
          id: "tc_1",
          name: "github:get_pull_request",
          input: { owner: "acme", repo: "app", pull_number: 42 },
          output: { title: "Add feature" },
          error: null,
          startedAt: new Date(),
          completedAt: new Date(),
        },
      ],
      startedAt: new Date(),
      completedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = RunSchema.safeParse(run);
    expect(result.success).toBe(true);
  });

  it("should validate all run statuses", () => {
    const statuses = ["pending", "running", "completed", "failed", "cancelled"];
    for (const status of statuses) {
      const result = RunStatusSchema.safeParse(status);
      expect(result.success).toBe(true);
    }
  });

  it("should reject invalid status", () => {
    const result = RunStatusSchema.safeParse("unknown");
    expect(result.success).toBe(false);
  });

  it("should validate a tool call", () => {
    const toolCall = {
      id: "tc_1",
      name: "mcp:tool_name",
      input: { key: "value" },
      output: { result: "success" },
      error: null,
      startedAt: new Date(),
      completedAt: new Date(),
    };

    const result = ToolCallSchema.safeParse(toolCall);
    expect(result.success).toBe(true);
  });

  it("should allow tool call with error", () => {
    const toolCall = {
      id: "tc_1",
      name: "mcp:tool_name",
      input: { key: "value" },
      output: null,
      error: "Connection timeout",
      startedAt: new Date(),
      completedAt: new Date(),
    };

    const result = ToolCallSchema.safeParse(toolCall);
    expect(result.success).toBe(true);
  });
});
