/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WorkflowExecutor } from "./workflow-executor.js";
import type {
  WorkflowRepository,
  SkillRepository,
  EventRepository,
  RunRepository,
  CheckpointRepository,
  HitlRequestRepository,
} from "@clawback/db";
import type { SkillExecutor } from "../skills/executor.js";
import type { NotificationService } from "./notifications.js";
import type { Workflow, WorkflowRun, Event, Skill } from "@clawback/shared";
import type { AiEngine, LoopConfig, LoopObserver, LoopResult } from "../ai/types.js";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const testWorkflow: Workflow = {
  id: "wf_test01",
  name: "Test Workflow",
  description: "A workflow for testing",
  instructions: "Orchestrate test skills",
  triggers: [{ source: "github", events: ["push"] }],
  skills: ["skill_test01"],
  orchestratorModel: "sonnet",
  enabled: true,
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

const testEvent: Event = {
  id: "evt_test01",
  source: "github",
  type: "push",
  payload: { repo: "test-repo", branch: "main" },
  metadata: {},
  status: "pending",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const testSkill: Skill = {
  id: "skill_test01",
  name: "Test Skill",
  description: "A skill for testing",
  instructions: "Do something useful",
  triggers: [{ source: "workflow", events: ["skill_spawn"] }],
  mcpServers: {},
  toolPermissions: { allow: ["*"], deny: [] },
  notifications: { onComplete: false, onError: true },
  isRemote: false,
  model: "sonnet",
};

const testWorkflowRun: WorkflowRun = {
  id: "wr_test01",
  workflowId: testWorkflow.id,
  eventId: testEvent.id,
  status: "pending",
  input: { repo: "test-repo" },
  skillRuns: [],
  createdAt: Date.now(),
  updatedAt: Date.now(),
};

// Reusable saved conversation state (messages array before HITL pause)
const savedMessages = [
  {
    role: "user",
    content: "Execute this workflow for the following trigger event...",
  },
  {
    role: "assistant",
    content: [
      {
        type: "tool_use",
        id: "toolu_hitl01",
        name: "request_human_input",
        input: {
          prompt: "Should I proceed with deployment?",
          context: "Changes look risky",
          options: ["Yes", "No"],
        },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Helper: create mock engine that simulates tool calls
// ---------------------------------------------------------------------------

function createMockEngine(
  behavior: "hitl" | "complete" | "complete_after_resume" = "complete"
): AiEngine {
  return {
    runLoop: vi
      .fn()
      .mockImplementation(
        async (config: LoopConfig, observer: LoopObserver): Promise<LoopResult> => {
          if (behavior === "hitl") {
            // Simulate: orchestrator calls request_human_input → engine pauses
            observer.onToolCall(
              "request_human_input",
              {
                prompt: "Should I proceed with deployment?",
                context: "Changes look risky",
                options: ["Yes", "No"],
                timeout_minutes: 30,
              },
              "toolu_hitl01"
            );

            // Find the request_human_input handler and call it
            const hitlTool = config.customTools?.find((t) => t.name === "request_human_input");
            if (hitlTool) {
              await hitlTool.handler({
                prompt: "Should I proceed with deployment?",
                context: "Changes look risky",
                options: ["Yes", "No"],
                timeout_minutes: 30,
              });
            }

            return {
              finalText: "",
              messages: [
                ...config.messages,
                {
                  role: "assistant",
                  content: [
                    {
                      type: "tool_use",
                      id: "toolu_hitl01",
                      name: "request_human_input",
                      input: {
                        prompt: "Should I proceed with deployment?",
                        context: "Changes look risky",
                        options: ["Yes", "No"],
                        timeout_minutes: 30,
                      },
                    },
                  ],
                },
              ],
              paused: true,
              pauseToolUseId: "toolu_hitl01",
            };
          }

          // "complete" or "complete_after_resume": orchestrator calls complete_workflow
          observer.onToolCall(
            "complete_workflow",
            {
              summary:
                behavior === "complete_after_resume" ? "Deployment approved by human" : "Completed",
            },
            "toolu_complete01"
          );

          // Call the complete_workflow handler
          const completeTool = config.customTools?.find((t) => t.name === "complete_workflow");
          if (completeTool) {
            await completeTool.handler({
              summary:
                behavior === "complete_after_resume" ? "Deployment approved by human" : "Completed",
            });
          }

          observer.onToolResult(
            "complete_workflow",
            "toolu_complete01",
            JSON.stringify({ success: true }),
            false
          );

          return {
            finalText: "",
            messages: config.messages,
          };
        }
      ),
  };
}

// ---------------------------------------------------------------------------
// Helper: build mock deps
// ---------------------------------------------------------------------------

function buildMockDeps(engineBehavior?: "hitl" | "complete" | "complete_after_resume") {
  const mockCheckpoint = {
    id: "cp_test01",
    workflowRunId: testWorkflowRun.id,
    sequence: 0,
    type: "hitl_request" as const,
    data: JSON.stringify({ prompt: "Should I proceed?", toolUseId: "toolu_hitl01" }),
    state: JSON.stringify(savedMessages),
    createdAt: Date.now(),
  };

  const mockHitlRequest = {
    id: "hitl_test01",
    workflowRunId: testWorkflowRun.id,
    checkpointId: mockCheckpoint.id,
    status: "responded" as const,
    prompt: "Should I proceed with deployment?",
    context: null,
    options: JSON.stringify(["Yes", "No"]),
    response: "Yes",
    timeoutAt: null,
    createdAt: Date.now(),
    respondedAt: Date.now(),
  };

  const workflowRepo: Partial<WorkflowRepository> = {
    createRun: vi.fn().mockReturnValue(testWorkflowRun),
    updateRunStatus: vi.fn().mockReturnValue(undefined),
    findRunById: vi.fn().mockReturnValue(testWorkflowRun),
    findById: vi.fn().mockReturnValue(testWorkflow),
    addSkillRun: vi.fn().mockReturnValue(undefined),
  };

  const skillRepo: Partial<SkillRepository> = {
    findById: vi.fn().mockReturnValue(testSkill),
  };

  const eventRepo: Partial<EventRepository> = {
    create: vi.fn().mockResolvedValue(testEvent),
    findById: vi.fn().mockResolvedValue(testEvent),
    updateStatus: vi.fn().mockResolvedValue(undefined),
  };

  const runRepo: Partial<RunRepository> = {
    create: vi.fn().mockResolvedValue(undefined),
  };

  const skillExecutor: Partial<SkillExecutor> = {
    execute: vi.fn().mockResolvedValue({
      id: "run_skill01",
      status: "completed",
      output: JSON.stringify({ result: "done" }),
      error: null,
    }),
  };

  const checkpointRepo: Partial<CheckpointRepository> = {
    create: vi.fn().mockReturnValue(mockCheckpoint),
    findById: vi.fn().mockReturnValue(mockCheckpoint),
    getNextSequence: vi.fn().mockReturnValue(1),
  };

  const hitlRequestRepo: Partial<HitlRequestRepository> = {
    create: vi.fn().mockReturnValue(mockHitlRequest),
    findById: vi.fn().mockReturnValue(mockHitlRequest),
  };

  const notificationService: Partial<NotificationService> = {
    broadcastMessage: vi.fn(),
    sendDesktopNotification: vi.fn().mockResolvedValue(undefined),
  };

  const engine = createMockEngine(engineBehavior ?? "complete");

  return {
    workflowRepo: workflowRepo as WorkflowRepository,
    skillRepo: skillRepo as SkillRepository,
    eventRepo: eventRepo as EventRepository,
    runRepo: runRepo as RunRepository,
    skillExecutor: skillExecutor as SkillExecutor,
    checkpointRepo: checkpointRepo as CheckpointRepository,
    hitlRequestRepo: hitlRequestRepo as HitlRequestRepository,
    notificationService: notificationService as NotificationService,
    engine,
    mockCheckpoint,
    mockHitlRequest,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkflowExecutor - HITL and checkpointing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // handleHitlRequest (exercised via execute)
  // -------------------------------------------------------------------------

  describe("handleHitlRequest (via execute)", () => {
    it("creates a hitl_request checkpoint with full message state", async () => {
      const deps = buildMockDeps("hitl");
      const executor = new WorkflowExecutor(deps);

      await executor.execute(testWorkflow, testEvent);

      // Checkpoint should be created with type "hitl_request" and state containing messages
      expect(deps.checkpointRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowRunId: testWorkflowRun.id,
          type: "hitl_request",
          data: expect.objectContaining({
            prompt: "Should I proceed with deployment?",
            toolUseId: "toolu_hitl01",
          }),
          // state is the full messages array at pause time
          state: expect.arrayContaining([
            expect.objectContaining({ role: "user" }),
            expect.objectContaining({ role: "assistant" }),
          ]),
        })
      );
    });

    it("creates a HITL request record with prompt, context, and options", async () => {
      const deps = buildMockDeps("hitl");
      const executor = new WorkflowExecutor(deps);

      await executor.execute(testWorkflow, testEvent);

      expect(deps.hitlRequestRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          workflowRunId: testWorkflowRun.id,
          prompt: "Should I proceed with deployment?",
          context: { text: "Changes look risky" },
          options: ["Yes", "No"],
        })
      );
    });

    it("sets workflow run status to waiting_for_input", async () => {
      const deps = buildMockDeps("hitl");
      const executor = new WorkflowExecutor(deps);

      await executor.execute(testWorkflow, testEvent);

      expect(deps.workflowRepo.updateRunStatus).toHaveBeenCalledWith(
        testWorkflowRun.id,
        "waiting_for_input"
      );
    });

    it("returns a run with status waiting_for_input", async () => {
      const deps = buildMockDeps("hitl");
      const executor = new WorkflowExecutor(deps);

      const result = await executor.execute(testWorkflow, testEvent);

      expect(result.status).toBe("waiting_for_input");
    });

    it("falls back gracefully when HITL repos are not configured", async () => {
      // Create engine that simulates HITL but the handler returns error (no repos)
      const engine: AiEngine = {
        runLoop: vi
          .fn()
          .mockImplementation(
            async (config: LoopConfig, observer: LoopObserver): Promise<LoopResult> => {
              // First call: HITL request but handler returns error (no repos)
              const hitlTool = config.customTools?.find((t) => t.name === "request_human_input");
              if (hitlTool) {
                const result = await hitlTool.handler({ prompt: "Proceed?" });
                // Without repos, handler returns result with error, not pause
                if (result.type === "result") {
                  observer.onToolResult(
                    "request_human_input",
                    "toolu_hitl01",
                    result.content,
                    true
                  );
                }
              }

              // Engine continues and calls complete_workflow
              const completeTool = config.customTools?.find((t) => t.name === "complete_workflow");
              if (completeTool) {
                await completeTool.handler({ summary: "Completed without HITL" });
              }

              return { finalText: "", messages: config.messages };
            }
          ),
      };

      const deps = buildMockDeps("complete");
      const executor = new WorkflowExecutor({
        workflowRepo: deps.workflowRepo,
        skillRepo: deps.skillRepo,
        eventRepo: deps.eventRepo,
        runRepo: deps.runRepo,
        skillExecutor: deps.skillExecutor,
        notificationService: deps.notificationService,
        engine,
        // No checkpointRepo or hitlRequestRepo
      });

      const result = await executor.execute(testWorkflow, testEvent);

      // Should not pause - falls back to continuing the loop
      expect(result.status).not.toBe("waiting_for_input");
    });
  });

  // -------------------------------------------------------------------------
  // resumeFromCheckpoint
  // -------------------------------------------------------------------------

  describe("resumeFromCheckpoint", () => {
    it("throws when the HITL request has not been responded to", async () => {
      const deps = buildMockDeps("complete_after_resume");

      // Override: request is still pending
      vi.mocked(deps.hitlRequestRepo.findById).mockReturnValue({
        ...deps.mockHitlRequest,
        status: "pending",
      });

      const executor = new WorkflowExecutor(deps);

      await expect(executor.resumeFromCheckpoint("hitl_test01")).rejects.toThrow(
        "has not been responded to"
      );
    });

    it("throws when the HITL request does not exist", async () => {
      const deps = buildMockDeps("complete_after_resume");

      vi.mocked(deps.hitlRequestRepo.findById).mockReturnValue(undefined);

      const executor = new WorkflowExecutor(deps);

      await expect(executor.resumeFromCheckpoint("hitl_missing")).rejects.toThrow("not found");
    });

    it("throws when the checkpoint is missing", async () => {
      const deps = buildMockDeps("complete_after_resume");

      vi.mocked(deps.checkpointRepo.findById).mockReturnValue(undefined);

      const executor = new WorkflowExecutor(deps);

      await expect(executor.resumeFromCheckpoint("hitl_test01")).rejects.toThrow(
        "not found or has no state"
      );
    });

    it("restores saved messages and appends the human response before calling engine", async () => {
      const deps = buildMockDeps("complete_after_resume");
      const executor = new WorkflowExecutor(deps);

      await executor.resumeFromCheckpoint("hitl_test01");

      expect(deps.engine.runLoop).toHaveBeenCalledTimes(1);

      const callArgs = (deps.engine.runLoop as ReturnType<typeof vi.fn>).mock
        .calls[0][0] as LoopConfig;
      const messages = callArgs.messages;

      // Should include the saved messages plus the appended tool_result with human response
      expect(messages).toHaveLength(savedMessages.length + 1);

      // Last message must be the human's tool_result response
      const lastMessage = messages[messages.length - 1] as {
        role: string;
        content: Array<{ type: string; tool_use_id: string; content: string }>;
      };
      expect(lastMessage.role).toBe("user");
      expect(lastMessage.content[0].type).toBe("tool_result");
      expect(lastMessage.content[0].tool_use_id).toBe("toolu_hitl01");

      const toolResultContent = JSON.parse(lastMessage.content[0].content) as {
        response: string;
      };
      expect(toolResultContent.response).toBe("Yes");
    });

    it("sets status back to running before resuming the orchestrator loop", async () => {
      const deps = buildMockDeps("complete_after_resume");
      const executor = new WorkflowExecutor(deps);

      await executor.resumeFromCheckpoint("hitl_test01");

      expect(deps.workflowRepo.updateRunStatus).toHaveBeenCalledWith(testWorkflowRun.id, "running");
    });

    it("sets status to completed after the orchestrator calls complete_workflow", async () => {
      const deps = buildMockDeps("complete_after_resume");
      const executor = new WorkflowExecutor(deps);

      const result = await executor.resumeFromCheckpoint("hitl_test01");

      expect(result.status).toBe("completed");
      expect(deps.workflowRepo.updateRunStatus).toHaveBeenCalledWith(
        testWorkflowRun.id,
        "completed",
        expect.objectContaining({ output: expect.anything() })
      );
    });

    it("returns waiting_for_input if the resumed orchestrator requests another HITL", async () => {
      const deps = buildMockDeps("complete_after_resume");

      // Second HITL checkpoint and request
      const secondCheckpoint = {
        ...deps.mockCheckpoint,
        id: "cp_test02",
        sequence: 2,
      };
      const secondHitlRequest = {
        ...deps.mockHitlRequest,
        id: "hitl_test02",
        checkpointId: secondCheckpoint.id,
      };

      vi.mocked(deps.checkpointRepo.create).mockReturnValue(secondCheckpoint);
      vi.mocked(deps.hitlRequestRepo.create).mockReturnValue(secondHitlRequest);

      // Override engine to pause again
      deps.engine.runLoop = vi
        .fn()
        .mockImplementation(
          async (config: LoopConfig, observer: LoopObserver): Promise<LoopResult> => {
            observer.onToolCall(
              "request_human_input",
              {
                prompt: "Which region should I deploy to?",
              },
              "toolu_hitl02"
            );

            const hitlTool = config.customTools?.find((t) => t.name === "request_human_input");
            if (hitlTool) {
              await hitlTool.handler({
                prompt: "Which region should I deploy to?",
              });
            }

            return {
              finalText: "",
              messages: [
                ...config.messages,
                {
                  role: "assistant",
                  content: [
                    {
                      type: "tool_use",
                      id: "toolu_hitl02",
                      name: "request_human_input",
                      input: { prompt: "Which region should I deploy to?" },
                    },
                  ],
                },
              ],
              paused: true,
              pauseToolUseId: "toolu_hitl02",
            };
          }
        );

      const executor = new WorkflowExecutor(deps);

      const result = await executor.resumeFromCheckpoint("hitl_test01");

      expect(result.status).toBe("waiting_for_input");
    });

    it("saves a hitl_response checkpoint before resuming the loop", async () => {
      const deps = buildMockDeps("complete_after_resume");
      const executor = new WorkflowExecutor(deps);

      await executor.resumeFromCheckpoint("hitl_test01");

      // saveWorkflowCheckpoint calls checkpointRepo.create with type "hitl_response"
      expect(deps.checkpointRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "hitl_response",
          data: expect.objectContaining({
            hitlRequestId: "hitl_test01",
            response: "Yes",
          }),
        })
      );
    });
  });
});
