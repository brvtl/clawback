import Anthropic from "@anthropic-ai/sdk";
import type { Skill } from "@clawback/shared";
import type {
  BuilderSessionRepository,
  WorkflowRepository,
  SkillRepository,
  CheckpointRepository,
  EventRepository,
} from "@clawback/db";
import { callWithRetry, type SkillExecutor } from "../skills/executor.js";
import type { NotificationService } from "./notifications.js";
import { getBuilderOrchestratorInstructions } from "./builder-seeds.js";

export interface BuilderExecutorDependencies {
  builderSessionRepo: BuilderSessionRepository;
  notificationService: NotificationService;
  anthropicApiKey?: string;
  workflowRepo: WorkflowRepository;
  skillRepo: SkillRepository;
  checkpointRepo: CheckpointRepository;
  eventRepo: EventRepository;
  skillExecutor: SkillExecutor;
  builderWorkflowId: string;
  builderSkillIds: string[];
}

// Orchestrator tools — same schema as WorkflowExecutor
const BUILDER_ORCHESTRATOR_TOOLS: Anthropic.Tool[] = [
  {
    name: "spawn_skill",
    description:
      "Execute a builder skill with the given inputs. Pass the skill ID and an inputs object with a 'task' string describing what the skill should do. Include ALL relevant context in the task — the skill has no memory of your conversation.",
    input_schema: {
      type: "object" as const,
      properties: {
        skillId: {
          type: "string",
          description: "The ID of the builder skill to execute",
        },
        inputs: {
          type: "object",
          description:
            "Input data for the skill. Must include a 'task' string with the full instructions.",
          additionalProperties: true,
        },
        reason: {
          type: "string",
          description: "Brief explanation of why you're spawning this skill",
        },
      },
      required: ["skillId", "inputs"],
    },
  },
  {
    name: "complete_workflow",
    description:
      "Mark the builder turn as completed with a summary of what was accomplished. Call this when the user's request has been fulfilled.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: {
          type: "string",
          description: "A summary of what was accomplished",
        },
      },
      required: ["summary"],
    },
  },
  {
    name: "fail_workflow",
    description:
      "Mark the builder turn as failed with an error message. Call this if the request cannot be completed.",
    input_schema: {
      type: "object" as const,
      properties: {
        error: {
          type: "string",
          description: "Description of why the request failed",
        },
      },
      required: ["error"],
    },
  },
];

export class BuilderExecutor {
  private anthropic: Anthropic | null = null;
  private builderSessionRepo: BuilderSessionRepository;
  private notificationService: NotificationService;
  private workflowRepo: WorkflowRepository;
  private skillRepo: SkillRepository;
  private checkpointRepo: CheckpointRepository;
  private eventRepo: EventRepository;
  private skillExecutor: SkillExecutor;
  private builderWorkflowId: string;
  private builderSkillIds: string[];
  private activeSessions = new Set<string>();

  constructor(deps: BuilderExecutorDependencies) {
    this.builderSessionRepo = deps.builderSessionRepo;
    this.notificationService = deps.notificationService;
    this.workflowRepo = deps.workflowRepo;
    this.skillRepo = deps.skillRepo;
    this.checkpointRepo = deps.checkpointRepo;
    this.eventRepo = deps.eventRepo;
    this.skillExecutor = deps.skillExecutor;
    this.builderWorkflowId = deps.builderWorkflowId;
    this.builderSkillIds = deps.builderSkillIds;

    if (deps.anthropicApiKey) {
      this.anthropic = new Anthropic({ apiKey: deps.anthropicApiKey });
      console.log("[BuilderExecutor] Initialized with Anthropic API key");
    } else {
      console.log(
        "[BuilderExecutor] WARNING: No ANTHROPIC_API_KEY configured - builder will not work"
      );
    }
  }

  isProcessing(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  startTurn(sessionId: string, userMessage: string): void {
    if (this.activeSessions.has(sessionId)) {
      throw new Error("Session is already processing");
    }

    // Mark as processing
    this.activeSessions.add(sessionId);
    this.builderSessionRepo.updateStatus(sessionId, "processing");
    this.broadcast(sessionId, "builder_status", { status: "processing" });

    // Load existing messages from DB
    const existingMessages = this.builderSessionRepo.getMessages(
      sessionId
    ) as Anthropic.MessageParam[];

    // Append user message
    existingMessages.push({ role: "user", content: userMessage });
    this.builderSessionRepo.updateMessages(sessionId, existingMessages);

    // Fire and forget
    void this.runLoop(sessionId, existingMessages, userMessage).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[BuilderExecutor] Session ${sessionId} error:`, errorMessage);
      this.builderSessionRepo.updateStatus(sessionId, "error", errorMessage);
      this.broadcast(sessionId, "builder_error", { error: errorMessage });
      this.activeSessions.delete(sessionId);
    });
  }

  private buildSystemPrompt(): string {
    // Resolve available builder skills from IDs
    const skillMap = new Map<string, string>();
    for (const id of this.builderSkillIds) {
      const skill = this.skillRepo.findById(id);
      if (skill) {
        skillMap.set(skill.name, skill.id);
      }
    }
    return getBuilderOrchestratorInstructions(skillMap);
  }

  private async runLoop(
    sessionId: string,
    messages: Anthropic.MessageParam[],
    userMessage: string
  ): Promise<void> {
    if (!this.anthropic) {
      throw new Error("ANTHROPIC_API_KEY is required for builder");
    }

    // Resolve available skills for spawn validation
    const availableSkills = this.builderSkillIds
      .map((id) => this.skillRepo.findById(id))
      .filter((s): s is Skill => s !== undefined);

    // Build system prompt dynamically from DB
    const systemPrompt = this.buildSystemPrompt();

    // Create event + workflow run for observability
    const event = await this.eventRepo.create({
      source: "builder",
      type: "chat.message",
      payload: { sessionId, message: userMessage },
      metadata: { sessionId },
    });

    const workflowRun = this.workflowRepo.createRun({
      workflowId: this.builderWorkflowId,
      eventId: event.id,
      input: { sessionId, message: userMessage },
    });
    const workflowRunId = workflowRun.id;
    this.workflowRepo.updateRunStatus(workflowRunId, "running");

    let continueLoop = true;
    let finalText = "";
    let cpSequence = this.checkpointRepo.getNextSequence(undefined, workflowRunId);

    try {
      while (continueLoop) {
        const response: Anthropic.Message = await callWithRetry(
          () =>
            this.anthropic!.messages.create({
              model: "claude-sonnet-4-20250514",
              max_tokens: 4096,
              system: systemPrompt,
              tools: BUILDER_ORCHESTRATOR_TOOLS,
              messages,
            }),
          3,
          "builder chat"
        );

        // Extract text blocks
        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === "text"
        );
        if (textBlocks.length > 0) {
          const text = textBlocks.map((b) => b.text).join("\n");
          finalText += text;
          this.broadcast(sessionId, "builder_text", { text });
          this.saveCheckpoint(workflowRunId, cpSequence++, "assistant_message", { text });
        }

        // Check for tool use
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
        );

        if (toolUseBlocks.length > 0) {
          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const toolUse of toolUseBlocks) {
            const toolName = toolUse.name;
            const toolInput = toolUse.input as Record<string, unknown>;

            if (toolName === "spawn_skill") {
              const skillId = toolInput.skillId as string;
              const inputs = toolInput.inputs as Record<string, unknown>;
              const reason = toolInput.reason as string | undefined;

              // Validate skill is in the allowed list
              const skill = availableSkills.find((s) => s.id === skillId);
              if (!skill) {
                const errMsg = `Skill ${skillId} is not available. Available: ${availableSkills.map((s) => `${s.name} (${s.id})`).join(", ")}`;
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: JSON.stringify({ error: errMsg }),
                  is_error: true,
                });
                this.broadcast(sessionId, "builder_tool_result", {
                  tool: toolName,
                  result: errMsg,
                  isError: true,
                });
                continue;
              }

              // Broadcast skill spawn
              this.broadcast(sessionId, "builder_tool_call", {
                tool: skill.name,
                args: { skillId, reason },
              });
              this.saveCheckpoint(workflowRunId, cpSequence++, "skill_spawn", {
                skillId,
                skillName: skill.name,
                inputs,
                reason,
              });

              let skillEventId: string | null = null;
              try {
                // Create synthetic event for the skill
                const skillEvent = await this.eventRepo.create({
                  source: "builder",
                  type: "skill_spawn",
                  payload: {
                    workflowRunId,
                    inputs,
                    reason,
                  },
                  metadata: { triggeredBy: "builder_orchestrator" },
                });
                skillEventId = skillEvent.id;

                // Execute via SkillExecutor (connects to MCP servers, runs tool loop)
                await this.eventRepo.updateStatus(skillEvent.id, "processing");
                const run = await this.skillExecutor.execute(skill, skillEvent);
                await this.eventRepo.updateStatus(
                  skillEvent.id,
                  run.status === "completed" ? "completed" : "failed"
                );

                // Track in workflow run
                this.workflowRepo.addSkillRun(workflowRunId, run.id);

                // Parse output
                const output = run.output ? (JSON.parse(run.output) as unknown) : undefined;
                const resultObj = {
                  runId: run.id,
                  skillName: skill.name,
                  status: run.status,
                  output,
                  error: run.error ?? undefined,
                };
                const resultStr = JSON.stringify(resultObj, null, 2);

                toolResults.push({
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: resultStr,
                });

                this.broadcast(sessionId, "builder_tool_result", {
                  tool: skill.name,
                  result: resultStr.length > 500 ? resultStr.slice(0, 500) + "..." : resultStr,
                });
                this.saveCheckpoint(workflowRunId, cpSequence++, "skill_complete", {
                  skillId,
                  skillName: skill.name,
                  status: run.status,
                  result: resultStr.length > 2000 ? resultStr.slice(0, 2000) + "..." : resultStr,
                });
              } catch (error) {
                if (skillEventId) {
                  await this.eventRepo.updateStatus(skillEventId, "failed");
                }
                const errMsg = error instanceof Error ? error.message : "Skill execution failed";
                toolResults.push({
                  type: "tool_result",
                  tool_use_id: toolUse.id,
                  content: JSON.stringify({ error: errMsg }),
                  is_error: true,
                });
                this.broadcast(sessionId, "builder_tool_result", {
                  tool: skill.name,
                  result: `Error: ${errMsg}`,
                  isError: true,
                });
                this.saveCheckpoint(workflowRunId, cpSequence++, "skill_complete", {
                  skillId,
                  skillName: skill.name,
                  status: "failed",
                  result: `Error: ${errMsg}`,
                });
              }
            } else if (toolName === "complete_workflow") {
              const summary = toolInput.summary as string;
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: JSON.stringify({ success: true }),
              });
              // Append final summary text if not already broadcast
              if (summary && !finalText.includes(summary)) {
                finalText += summary;
              }
              continueLoop = false;
            } else if (toolName === "fail_workflow") {
              const errorMsg = toolInput.error as string;
              this.saveCheckpoint(workflowRunId, cpSequence++, "error", { error: errorMsg });
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: JSON.stringify({ failed: true }),
              });
              continueLoop = false;
            } else {
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: JSON.stringify({ error: `Unknown tool: ${toolName}` }),
                is_error: true,
              });
            }
          }

          // Append assistant turn + tool results
          messages.push(
            { role: "assistant", content: response.content },
            { role: "user", content: toolResults }
          );

          // Persist messages after every turn
          this.builderSessionRepo.updateMessages(sessionId, messages);
        } else {
          continueLoop = false;
        }

        if (response.stop_reason === "end_turn" && toolUseBlocks.length === 0) {
          continueLoop = false;
        }
      }

      // Done: set status back to active (ready for next turn)
      this.builderSessionRepo.updateMessages(sessionId, messages);
      this.builderSessionRepo.updateStatus(sessionId, "active");

      // Auto-generate title from first user message if none set
      const session = this.builderSessionRepo.findById(sessionId);
      if (session && !session.title) {
        const firstUserMsg = messages.find(
          (m) => m.role === "user" && typeof m.content === "string"
        );
        if (firstUserMsg && typeof firstUserMsg.content === "string") {
          this.builderSessionRepo.updateTitle(sessionId, firstUserMsg.content.slice(0, 100));
        }
      }

      this.broadcast(sessionId, "builder_complete", { finalText });
      this.workflowRepo.updateRunStatus(workflowRunId, "completed", {
        output: { summary: finalText },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.saveCheckpoint(workflowRunId, cpSequence++, "error", { error: errorMessage });
      this.workflowRepo.updateRunStatus(workflowRunId, "failed", { error: errorMessage });
      throw error;
    } finally {
      this.activeSessions.delete(sessionId);
    }
  }

  private saveCheckpoint(
    workflowRunId: string,
    sequence: number,
    type:
      | "assistant_message"
      | "tool_call"
      | "tool_result"
      | "skill_spawn"
      | "skill_complete"
      | "error",
    data: unknown
  ): void {
    const checkpoint = this.checkpointRepo.create({
      workflowRunId,
      sequence,
      type,
      data,
    });
    this.notificationService.broadcastMessage({
      type: "checkpoint",
      workflowRunId,
      checkpoint: {
        id: checkpoint.id,
        sequence,
        type: checkpoint.type,
        data,
        createdAt: checkpoint.createdAt,
      },
    });
  }

  private broadcast(sessionId: string, type: string, data: Record<string, unknown>): void {
    this.notificationService.broadcastMessage({
      type,
      sessionId,
      ...data,
    });
  }
}
