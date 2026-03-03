import type Anthropic from "@anthropic-ai/sdk";
import type { Workflow, WorkflowRun, Skill, Event, SkillRunResult } from "@clawback/shared";
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
import type { AiEngine, CustomToolDef } from "../ai/types.js";

export interface WorkflowExecutorDependencies {
  workflowRepo: WorkflowRepository;
  skillRepo: SkillRepository;
  eventRepo: EventRepository;
  runRepo: RunRepository;
  skillExecutor: SkillExecutor;
  checkpointRepo?: CheckpointRepository;
  hitlRequestRepo?: HitlRequestRepository;
  notificationService?: NotificationService;
  engine?: AiEngine;
}

export interface OrchestratorLoopResult {
  output: unknown;
  paused?: boolean;
  hitlRequestId?: string;
}

export class WorkflowExecutor {
  private workflowRepo: WorkflowRepository;
  private skillRepo: SkillRepository;
  private eventRepo: EventRepository;
  private skillExecutor: SkillExecutor;
  private checkpointRepo?: CheckpointRepository;
  private hitlRequestRepo?: HitlRequestRepository;
  private notificationService?: NotificationService;
  private engine?: AiEngine;

  constructor(deps: WorkflowExecutorDependencies) {
    this.workflowRepo = deps.workflowRepo;
    this.skillRepo = deps.skillRepo;
    this.eventRepo = deps.eventRepo;
    this.skillExecutor = deps.skillExecutor;
    this.checkpointRepo = deps.checkpointRepo;
    this.hitlRequestRepo = deps.hitlRequestRepo;
    this.notificationService = deps.notificationService;
    this.engine = deps.engine;

    if (deps.engine) {
      console.log("[WorkflowExecutor] Initialized with AiEngine");
    } else {
      console.log("[WorkflowExecutor] WARNING: No AiEngine configured - workflows will not run");
    }
  }

  async execute(workflow: Workflow, event: Event): Promise<WorkflowRun> {
    if (!this.engine) {
      throw new Error("AiEngine is required for workflow execution");
    }

    // Parse event payload (may be string from DB or already parsed Record)
    const rawPayload = event.payload as string | Record<string, unknown>;
    const payload: Record<string, unknown> =
      typeof rawPayload === "string"
        ? (JSON.parse(rawPayload) as Record<string, unknown>)
        : rawPayload;

    // Create workflow run record
    const workflowRun = this.workflowRepo.createRun({
      workflowId: workflow.id,
      eventId: event.id,
      input: payload,
    });

    try {
      // Update status to running
      this.workflowRepo.updateRunStatus(workflowRun.id, "running");

      // Run the orchestrator loop
      const result = await this.runOrchestratorLoop(workflow, event, workflowRun);

      // Check if workflow was paused for HITL
      if (result.paused) {
        return {
          ...workflowRun,
          status: "waiting_for_input" as const,
          output: result.output,
        };
      }

      // Update status to completed
      this.workflowRepo.updateRunStatus(workflowRun.id, "completed", {
        output: result.output,
      });

      return { ...workflowRun, status: "completed", output: result.output };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      // Update status to failed
      this.workflowRepo.updateRunStatus(workflowRun.id, "failed", {
        error: errorMessage,
      });

      throw error;
    }
  }

  private async runOrchestratorLoop(
    workflow: Workflow,
    event: Event,
    workflowRun: WorkflowRun,
    resumeMessages?: Anthropic.MessageParam[]
  ): Promise<OrchestratorLoopResult> {
    if (!this.engine) {
      throw new Error("AiEngine not initialized");
    }

    // Get available skills
    const availableSkills = workflow.skills
      .map((skillId) => this.skillRepo.findById(skillId))
      .filter((s): s is Skill => s !== undefined);

    if (availableSkills.length === 0) {
      throw new Error("No valid skills found for workflow");
    }

    // Build system prompt
    const systemPrompt = this.buildOrchestratorPrompt(workflow, availableSkills, event);
    const userMessage = this.buildUserMessage(event);

    // Select model based on workflow config
    const model =
      workflow.orchestratorModel === "opus" ? "claude-opus-4-20250514" : "claude-sonnet-4-20250514";

    const messages: Anthropic.MessageParam[] = resumeMessages ?? [
      { role: "user", content: userMessage },
    ];
    const skillResults: SkillRunResult[] = [];
    let finalOutput: unknown = null;
    let cpSequence = this.checkpointRepo?.getNextSequence(undefined, workflowRun.id) ?? 0;

    console.log(
      `[WorkflowExecutor] Starting orchestration for workflow "${workflow.name}" with model ${model}${resumeMessages ? " (resumed)" : ""}`
    );

    // Build custom tools for the orchestrator
    const customTools: CustomToolDef[] = [
      {
        name: "spawn_skill",
        description:
          "Execute a skill with the given inputs. The skill will process the inputs and return results. Use this to delegate work to specialized skills.",
        inputSchema: {
          type: "object" as const,
          properties: {
            skillId: { type: "string", description: "The ID of the skill to execute" },
            inputs: {
              type: "object",
              description: "Input data to pass to the skill.",
              additionalProperties: true,
            },
            reason: {
              type: "string",
              description: "Brief explanation of why you're spawning this skill",
            },
          },
          required: ["skillId", "inputs"],
        },
        handler: async (input: Record<string, unknown>) => {
          this.saveWorkflowCheckpoint(workflowRun.id, cpSequence++, "skill_spawn", {
            skillId: input.skillId,
            inputs: input.inputs,
            reason: input.reason,
          });

          const spawnResult = await this.handleSpawnSkill(
            input,
            event,
            workflowRun,
            availableSkills
          );

          const isError = !!spawnResult.error;

          this.saveWorkflowCheckpoint(workflowRun.id, cpSequence++, "skill_complete", {
            skillId: input.skillId,
            status: isError ? "failed" : "completed",
            result: isError ? spawnResult.error : spawnResult.result,
          });

          if (isError) {
            return {
              type: "result" as const,
              content: JSON.stringify({ error: spawnResult.error }),
              isError: true,
            };
          }

          if (spawnResult.result) {
            skillResults.push(spawnResult.result);
          }
          return { type: "result" as const, content: JSON.stringify(spawnResult.result) };
        },
      },
      {
        name: "complete_workflow",
        description:
          "Mark the workflow as completed with a summary of what was accomplished. Call this when all required skills have been executed successfully.",
        inputSchema: {
          type: "object" as const,
          properties: {
            summary: {
              type: "string",
              description: "A summary of what was accomplished in this workflow run",
            },
            results: {
              type: "object",
              description: "Key results from the workflow execution",
              additionalProperties: true,
            },
          },
          required: ["summary"],
        },
        handler: (input: Record<string, unknown>) => {
          const summary = input.summary as string;
          const results = input.results as Record<string, unknown> | undefined;
          finalOutput = {
            summary,
            results: results ?? {},
            skillRuns: skillResults,
          };
          console.log(`[WorkflowExecutor] Workflow completed: ${summary}`);
          return { type: "result" as const, content: JSON.stringify({ success: true, summary }) };
        },
      },
      {
        name: "fail_workflow",
        description:
          "Mark the workflow as failed with an error message. Call this if a critical skill fails or the workflow cannot be completed.",
        inputSchema: {
          type: "object" as const,
          properties: {
            error: { type: "string", description: "Description of why the workflow failed" },
            partialResults: {
              type: "object",
              description: "Any partial results that were obtained before failure",
              additionalProperties: true,
            },
          },
          required: ["error"],
        },
        handler: (input: Record<string, unknown>) => {
          const error = input.error as string;
          const partialResults = input.partialResults as Record<string, unknown> | undefined;
          finalOutput = {
            error,
            partialResults: partialResults ?? {},
            skillRuns: skillResults,
          };

          this.saveWorkflowCheckpoint(workflowRun.id, cpSequence++, "error", {
            error,
            partialResults,
          });

          console.log(`[WorkflowExecutor] Workflow failed: ${error}`);
          // Throw to trigger failed status at the executor level
          throw new Error(error);
        },
      },
      {
        name: "request_human_input",
        description:
          "Pause the workflow and request input from a human operator. Use this when you need confirmation, clarification, or a decision before proceeding.",
        inputSchema: {
          type: "object" as const,
          properties: {
            prompt: {
              type: "string",
              description: "What you need from the human - be specific and clear",
            },
            context: {
              type: "string",
              description: "Additional context to help the human understand the situation",
            },
            options: {
              type: "array",
              items: { type: "string" },
              description: "Suggested responses the human can choose from",
            },
            timeout_minutes: {
              type: "number",
              description: "How long to wait for a response before the request expires",
            },
          },
          required: ["prompt"],
        },
        handler: (_input: Record<string, unknown>) => {
          if (!this.checkpointRepo || !this.hitlRequestRepo) {
            return {
              type: "result" as const,
              content: JSON.stringify({ error: "Human-in-the-loop is not configured" }),
              isError: true,
            };
          }

          // Signal the engine to pause — the engine will stop the loop and return
          // the current messages for checkpoint state reconstruction
          return { type: "pause" as const, toolUseId: "hitl_pending" };
        },
      },
    ];

    const result = await this.engine.runLoop(
      {
        systemPrompt,
        messages,
        model,
        mcpServers: {},
        customTools,
      },
      {
        onText: (text) => {
          this.saveWorkflowCheckpoint(workflowRun.id, cpSequence++, "assistant_message", { text });
        },
        onToolCall: (toolName, toolInput, toolUseId) => {
          console.log(`[WorkflowExecutor] Tool call: ${toolName}`);
          this.saveWorkflowCheckpoint(workflowRun.id, cpSequence++, "tool_call", {
            toolName,
            toolInput,
            toolUseId,
          });
        },
        onToolResult: (toolName, toolUseId, resultText, isError) => {
          this.saveWorkflowCheckpoint(workflowRun.id, cpSequence++, "tool_result", {
            toolName,
            toolUseId,
            result: resultText,
            isError,
          });
        },
      }
    );

    // Handle HITL pause
    if (result.paused) {
      // Find the request_human_input tool call in the last assistant message
      // to get the actual toolUseId and input
      const hitlResult = this.handleHitlFromPause(result, workflowRun, cpSequence);
      if (hitlResult) {
        return {
          output: finalOutput,
          paused: true,
          hitlRequestId: hitlResult.hitlRequestId,
        };
      }
      // Fallback if HITL couldn't be created — shouldn't happen normally
    }

    // If no tool set finalOutput, use the text response
    if (!finalOutput && result.finalText) {
      finalOutput = {
        summary: result.finalText,
        skillRuns: skillResults,
      };
    }

    return { output: finalOutput };
  }

  /**
   * After the engine pauses for HITL, extract the tool call info from result.messages
   * and create the checkpoint + HITL request.
   */
  private handleHitlFromPause(
    result: { messages: Anthropic.MessageParam[]; pauseToolUseId?: string },
    workflowRun: WorkflowRun,
    cpSequence: number
  ): { hitlRequestId: string } | null {
    if (!this.checkpointRepo || !this.hitlRequestRepo) return null;

    // Find the request_human_input tool call in the messages
    // It's in the last assistant message
    const lastAssistant = [...result.messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return null;

    const content = lastAssistant.content as Anthropic.ContentBlock[];
    const hitlToolUse = Array.isArray(content)
      ? content.find(
          (block): block is Anthropic.ToolUseBlock =>
            block.type === "tool_use" &&
            (block.name === "request_human_input" ||
              block.name === "mcp__clawback-custom__request_human_input")
        )
      : undefined;

    if (!hitlToolUse) return null;

    const toolInput = hitlToolUse.input as Record<string, unknown>;
    const prompt = toolInput.prompt as string;
    const context = toolInput.context as string | undefined;
    const options = toolInput.options as string[] | undefined;
    const timeoutMinutes = toolInput.timeout_minutes as number | undefined;
    const toolUseId = hitlToolUse.id;

    // Save checkpoint with full state
    const checkpoint = this.checkpointRepo.create({
      workflowRunId: workflowRun.id,
      sequence: cpSequence,
      type: "hitl_request",
      data: { prompt, context, options, toolUseId },
      state: result.messages,
    });

    // Create HITL request
    const hitlRequest = this.hitlRequestRepo.create({
      workflowRunId: workflowRun.id,
      checkpointId: checkpoint.id,
      prompt,
      context: context ? { text: context } : undefined,
      options,
      timeoutAt: timeoutMinutes ? Date.now() + timeoutMinutes * 60 * 1000 : undefined,
    });

    // Set workflow run status to waiting_for_input
    this.workflowRepo.updateRunStatus(workflowRun.id, "waiting_for_input");

    this.notificationService?.broadcastMessage({
      type: "run_status",
      workflowRunId: workflowRun.id,
      status: "waiting_for_input",
    });

    // Broadcast HITL request
    this.notificationService?.broadcastMessage({
      type: "hitl_request",
      workflowRunId: workflowRun.id,
      request: {
        id: hitlRequest.id,
        prompt,
        context,
        options,
        timeoutAt: timeoutMinutes ? Date.now() + timeoutMinutes * 60 * 1000 : undefined,
      },
    });

    // Desktop notification
    void this.notificationService?.sendDesktopNotification({
      id: hitlRequest.id,
      type: "warning",
      title: "Human Input Needed",
      message: prompt,
    });

    console.log(
      `[WorkflowExecutor] HITL request created: ${hitlRequest.id} for workflow run ${workflowRun.id}`
    );

    return { hitlRequestId: hitlRequest.id };
  }

  private buildUserMessage(event: Event): string {
    const rawEventPayload = event.payload as string | Record<string, unknown>;
    const eventPayload: Record<string, unknown> =
      typeof rawEventPayload === "string"
        ? (JSON.parse(rawEventPayload) as Record<string, unknown>)
        : rawEventPayload;

    return `Execute this workflow for the following trigger event:

**Source:** ${event.source}
**Type:** ${event.type}

**Payload:**
\`\`\`json
${JSON.stringify(eventPayload, null, 2)}
\`\`\`

Analyze the event and orchestrate the appropriate skills to complete the workflow.`;
  }

  private async handleSpawnSkill(
    input: Record<string, unknown>,
    triggerEvent: Event,
    workflowRun: WorkflowRun,
    availableSkills: Skill[]
  ): Promise<{ result?: SkillRunResult; error?: string }> {
    const skillId = input.skillId as string;
    const skillInputs = input.inputs as Record<string, unknown>;
    const reason = input.reason as string | undefined;

    // Validate skill is in the allowed list
    const skill = availableSkills.find((s) => s.id === skillId);
    if (!skill) {
      return { error: `Skill ${skillId} is not available in this workflow` };
    }

    console.log(
      `[WorkflowExecutor] Spawning skill "${skill.name}" (${skillId})${reason ? `: ${reason}` : ""}`
    );

    // Create the event outside try block so we can update its status on error
    const skillEvent = await this.eventRepo.create({
      source: "workflow",
      type: "skill_spawn",
      payload: {
        workflowRunId: workflowRun.id,
        workflowId: workflowRun.workflowId,
        parentEventId: triggerEvent.id,
        inputs: skillInputs,
        reason,
      },
      metadata: {
        triggeredBy: "workflow_orchestrator",
      },
    });

    try {
      // Execute the skill
      const run = await this.skillExecutor.execute(skill, skillEvent);

      // Update the event status based on the run result
      await this.eventRepo.updateStatus(
        skillEvent.id,
        run.status === "completed" ? "completed" : "failed"
      );

      // Track the skill run in the workflow run
      this.workflowRepo.addSkillRun(workflowRun.id, run.id);

      // Parse output
      const output = run.output ? (JSON.parse(run.output) as unknown) : undefined;

      const result: SkillRunResult = {
        runId: run.id,
        skillId: skill.id,
        skillName: skill.name,
        status: run.status === "completed" ? "completed" : "failed",
        output,
        error: run.error ?? undefined,
      };

      console.log(
        `[WorkflowExecutor] Skill "${skill.name}" completed with status: ${result.status}`
      );

      return { result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Skill execution failed";
      console.error(`[WorkflowExecutor] Skill "${skill.name}" failed:`, errorMessage);

      // Mark the event as failed
      await this.eventRepo.updateStatus(skillEvent.id, "failed");

      return {
        result: {
          runId: "unknown",
          skillId: skill.id,
          skillName: skill.name,
          status: "failed",
          error: errorMessage,
        },
      };
    }
  }

  private saveWorkflowCheckpoint(
    workflowRunId: string,
    sequence: number,
    type:
      | "assistant_message"
      | "tool_call"
      | "tool_result"
      | "skill_spawn"
      | "skill_complete"
      | "hitl_request"
      | "hitl_response"
      | "error",
    data: unknown,
    state?: unknown
  ): void {
    if (!this.checkpointRepo) return;

    try {
      const checkpoint = this.checkpointRepo.create({
        workflowRunId,
        sequence,
        type,
        data,
        state,
      });

      this.notificationService?.broadcastMessage({
        type: "checkpoint",
        workflowRunId,
        checkpoint: {
          id: checkpoint.id,
          sequence: checkpoint.sequence,
          type: checkpoint.type,
          data,
          createdAt: checkpoint.createdAt,
        },
      });
    } catch (err) {
      console.error("[WorkflowExecutor] Failed to save checkpoint:", err);
    }
  }

  async resumeFromCheckpoint(hitlRequestId: string): Promise<WorkflowRun> {
    if (!this.engine) {
      throw new Error("AiEngine not initialized");
    }
    if (!this.hitlRequestRepo || !this.checkpointRepo) {
      throw new Error("HITL repos not configured");
    }

    // Load HITL request
    const hitlRequest = this.hitlRequestRepo.findById(hitlRequestId);
    if (!hitlRequest) {
      throw new Error(`HITL request ${hitlRequestId} not found`);
    }
    if (hitlRequest.status !== "responded") {
      throw new Error(`HITL request ${hitlRequestId} has not been responded to`);
    }

    // Load checkpoint
    const checkpoint = this.checkpointRepo.findById(hitlRequest.checkpointId);
    if (!checkpoint?.state) {
      throw new Error(`Checkpoint ${hitlRequest.checkpointId} not found or has no state`);
    }

    // Parse saved state → reconstruct messages
    const savedMessages = JSON.parse(checkpoint.state) as Anthropic.MessageParam[];

    // Parse checkpoint data to get toolUseId
    const cpData = JSON.parse(checkpoint.data) as { toolUseId: string };

    // Append the tool_result with the human's response
    const messages: Anthropic.MessageParam[] = [
      ...savedMessages,
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: cpData.toolUseId,
            content: JSON.stringify({
              response: hitlRequest.response,
              respondedAt: hitlRequest.respondedAt,
            }),
          },
        ],
      },
    ];

    // Save hitl_response checkpoint
    this.saveWorkflowCheckpoint(
      hitlRequest.workflowRunId,
      this.checkpointRepo.getNextSequence(undefined, hitlRequest.workflowRunId),
      "hitl_response",
      { hitlRequestId, response: hitlRequest.response }
    );

    // Load workflow + event from workflow run
    const workflowRun = this.workflowRepo.findRunById(hitlRequest.workflowRunId);
    if (!workflowRun) {
      throw new Error(`Workflow run ${hitlRequest.workflowRunId} not found`);
    }

    const workflow = this.workflowRepo.findById(workflowRun.workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowRun.workflowId} not found`);
    }

    const event = await this.eventRepo.findById(workflowRun.eventId);
    if (!event) {
      throw new Error(`Event ${workflowRun.eventId} not found`);
    }

    // Set status back to running
    this.workflowRepo.updateRunStatus(workflowRun.id, "running");

    this.notificationService?.broadcastMessage({
      type: "run_status",
      workflowRunId: workflowRun.id,
      status: "running",
    });

    console.log(
      `[WorkflowExecutor] Resuming workflow run ${workflowRun.id} from HITL request ${hitlRequestId}`
    );

    try {
      // Resume the orchestrator loop with restored messages
      const result = await this.runOrchestratorLoop(workflow, event, workflowRun, messages);

      if (result.paused) {
        return { ...workflowRun, status: "waiting_for_input" as const, output: result.output };
      }

      this.workflowRepo.updateRunStatus(workflowRun.id, "completed", {
        output: result.output,
      });

      return { ...workflowRun, status: "completed", output: result.output };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.workflowRepo.updateRunStatus(workflowRun.id, "failed", {
        error: errorMessage,
      });
      throw error;
    }
  }

  private buildOrchestratorPrompt(workflow: Workflow, skills: Skill[], event: Event): string {
    const skillDescriptions = skills
      .map(
        (s) => `- **${s.name}** (ID: ${s.id})
  ${s.description ?? "No description"}
  Triggers: ${s.triggers.map((t) => `${t.source}/${t.events?.join(",") ?? "any"}`).join(", ")}`
      )
      .join("\n\n");

    return `You are an AI orchestrator executing the workflow "${workflow.name}".

## Workflow Description
${workflow.description ?? "No description provided."}

## Your Instructions
${workflow.instructions}

## Available Skills
You can spawn any of these skills to accomplish parts of the workflow:

${skillDescriptions}

## Orchestration Guidelines

1. **Analyze the trigger event** to understand what needs to be done
2. **Plan your approach** - decide which skills to run and in what order
3. **Spawn skills** using the \`spawn_skill\` tool with appropriate inputs
4. **Handle results** - check skill outputs and decide next steps
5. **Handle errors** - if a skill fails, decide whether to retry, skip, or fail the workflow
6. **Request human input** - use \`request_human_input\` when you need confirmation, clarification, or a decision before proceeding
7. **Complete the workflow** - call \`complete_workflow\` with a summary when done
8. **Fail gracefully** - call \`fail_workflow\` if the workflow cannot be completed

## Event Context
- Source: ${event.source}
- Type: ${event.type}
- Event ID: ${event.id}

## Important Notes
- You can spawn multiple skills if needed
- Skills may return data that should be passed to subsequent skills
- Always include a clear reason when spawning skills
- Summarize the overall outcome when completing the workflow`;
  }
}
