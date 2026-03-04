import type Anthropic from "@anthropic-ai/sdk";
import type { Skill } from "@clawback/shared";
import type {
  BuilderSessionRepository,
  WorkflowRepository,
  SkillRepository,
  CheckpointRepository,
  EventRepository,
  McpServerRepository,
} from "@clawback/db";
import type { SkillExecutor } from "../skills/executor.js";
import type { NotificationService } from "./notifications.js";
import { getBuilderOrchestratorInstructions } from "./builder-seeds.js";
import type { AiEngine, CustomToolDef } from "../ai/types.js";
import { discoverServerTools, type McpToolInfo } from "../mcp/tools.js";

export interface BuilderExecutorDependencies {
  builderSessionRepo: BuilderSessionRepository;
  notificationService: NotificationService;
  workflowRepo: WorkflowRepository;
  skillRepo: SkillRepository;
  checkpointRepo: CheckpointRepository;
  eventRepo: EventRepository;
  skillExecutor: SkillExecutor;
  mcpServerRepo: McpServerRepository;
  builderWorkflowId: string;
  builderSkillIds: string[];
  engine?: AiEngine;
}

export class BuilderExecutor {
  private builderSessionRepo: BuilderSessionRepository;
  private notificationService: NotificationService;
  private workflowRepo: WorkflowRepository;
  private skillRepo: SkillRepository;
  private checkpointRepo: CheckpointRepository;
  private eventRepo: EventRepository;
  private skillExecutor: SkillExecutor;
  private mcpServerRepo: McpServerRepository;
  private builderWorkflowId: string;
  private builderSkillIds: string[];
  private activeSessions = new Set<string>();
  private engine?: AiEngine;
  private toolCache = new Map<string, McpToolInfo[]>();

  constructor(deps: BuilderExecutorDependencies) {
    this.builderSessionRepo = deps.builderSessionRepo;
    this.notificationService = deps.notificationService;
    this.workflowRepo = deps.workflowRepo;
    this.skillRepo = deps.skillRepo;
    this.checkpointRepo = deps.checkpointRepo;
    this.eventRepo = deps.eventRepo;
    this.skillExecutor = deps.skillExecutor;
    this.mcpServerRepo = deps.mcpServerRepo;
    this.builderWorkflowId = deps.builderWorkflowId;
    this.builderSkillIds = deps.builderSkillIds;
    this.engine = deps.engine;

    if (deps.engine) {
      console.log("[BuilderExecutor] Initialized with AiEngine");
    } else {
      console.log("[BuilderExecutor] WARNING: No AiEngine configured - builder will not work");
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

  private async buildSystemPrompt(): Promise<string> {
    // Resolve available builder skills from IDs
    const skillMap = new Map<string, string>();
    for (const id of this.builderSkillIds) {
      const skill = this.skillRepo.findById(id);
      if (skill) {
        skillMap.set(skill.name, skill.id);
      }
    }

    // Get MCP server configs and discover tools for each
    const serverConfigs = this.buildMcpServersConfig();
    const mcpServerTools = new Map<string, string[]>();

    // Discover tools for servers not yet in cache
    const uncachedServers = Object.entries(serverConfigs).filter(
      ([name]) => !this.toolCache.has(name)
    );
    if (uncachedServers.length > 0) {
      const discoveries = await Promise.all(
        uncachedServers.map(async ([name, config]) => {
          const tools = await discoverServerTools(name, config);
          return { name, tools };
        })
      );
      for (const { name, tools } of discoveries) {
        this.toolCache.set(name, tools);
        if (tools.length > 0) {
          console.log(`[BuilderExecutor] Discovered ${tools.length} tools from ${name} server`);
        }
      }
    }

    // Build namespaced tool name map from cache
    for (const serverName of Object.keys(serverConfigs)) {
      const cached = this.toolCache.get(serverName) ?? [];
      mcpServerTools.set(
        serverName,
        cached.map((t) => `mcp__${serverName}__${t.name}`)
      );
    }

    return getBuilderOrchestratorInstructions(skillMap, mcpServerTools);
  }

  private buildMcpServersConfig(): Record<
    string,
    { command: string; args: string[]; env?: Record<string, string> }
  > {
    const servers = this.mcpServerRepo.findAll(true); // enabled only
    const config: Record<
      string,
      { command: string; args: string[]; env?: Record<string, string> }
    > = {};
    for (const server of servers) {
      if (server.name === "clawback") continue; // Builder skills handle Clawback API access
      config[server.name] = {
        command: server.command,
        args: Array.isArray(server.args) ? server.args : [],
        env: server.env ?? undefined,
      };
    }
    return config;
  }

  private async runLoop(
    sessionId: string,
    messages: Anthropic.MessageParam[],
    userMessage: string
  ): Promise<void> {
    if (!this.engine) {
      throw new Error("AiEngine is required for builder");
    }

    // Resolve available skills for spawn validation
    const availableSkills = this.builderSkillIds
      .map((id) => this.skillRepo.findById(id))
      .filter((s): s is Skill => s !== undefined);

    // Build system prompt dynamically from DB (discovers MCP tools on first call)
    const systemPrompt = await this.buildSystemPrompt();

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

    let finalText = "";
    let cpSequence = this.checkpointRepo.getNextSequence(undefined, workflowRunId);

    // Build custom tools for the builder orchestrator
    const customTools: CustomToolDef[] = [
      {
        name: "spawn_skill",
        description:
          "Execute a builder skill with the given inputs. Pass the skill ID and an inputs object with a 'task' string describing what the skill should do.",
        inputSchema: {
          type: "object" as const,
          properties: {
            skillId: { type: "string", description: "The ID of the builder skill to execute" },
            inputs: {
              type: "object",
              description: "Input data for the skill. Must include a 'task' string.",
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
          const skillId = input.skillId as string;
          const inputs = input.inputs as Record<string, unknown>;
          const reason = input.reason as string | undefined;

          // Validate skill is in the allowed list
          const skill = availableSkills.find((s) => s.id === skillId);
          if (!skill) {
            const errMsg = `Skill ${skillId} is not available. Available: ${availableSkills.map((s) => `${s.name} (${s.id})`).join(", ")}`;
            this.broadcast(sessionId, "builder_tool_result", {
              tool: "spawn_skill",
              result: errMsg,
              isError: true,
            });
            return {
              type: "result" as const,
              content: JSON.stringify({ error: errMsg }),
              isError: true,
            };
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
              payload: { workflowRunId, inputs, reason },
              metadata: { triggeredBy: "builder_orchestrator" },
            });
            skillEventId = skillEvent.id;

            // Execute via SkillExecutor
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

            return { type: "result" as const, content: resultStr };
          } catch (error) {
            if (skillEventId) {
              await this.eventRepo.updateStatus(skillEventId, "failed");
            }
            const errMsg = error instanceof Error ? error.message : "Skill execution failed";
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
            return {
              type: "result" as const,
              content: JSON.stringify({ error: errMsg }),
              isError: true,
            };
          }
        },
      },
      {
        name: "complete_workflow",
        description: "Mark the builder turn as completed with a summary of what was accomplished.",
        inputSchema: {
          type: "object" as const,
          properties: {
            summary: { type: "string", description: "A summary of what was accomplished" },
          },
          required: ["summary"],
        },
        handler: (input: Record<string, unknown>) => {
          const summary = input.summary as string;
          if (summary && !finalText.includes(summary)) {
            finalText += summary;
          }
          return { type: "result" as const, content: JSON.stringify({ success: true }) };
        },
      },
      {
        name: "fail_workflow",
        description: "Mark the builder turn as failed with an error message.",
        inputSchema: {
          type: "object" as const,
          properties: {
            error: { type: "string", description: "Description of why the request failed" },
          },
          required: ["error"],
        },
        handler: (input: Record<string, unknown>) => {
          const errorMsg = input.error as string;
          this.saveCheckpoint(workflowRunId, cpSequence++, "error", { error: errorMsg });
          return { type: "result" as const, content: JSON.stringify({ failed: true }) };
        },
      },
    ];

    try {
      const result = await this.engine.runLoop(
        {
          systemPrompt,
          messages,
          model: "claude-sonnet-4-20250514",
          mcpServers: this.buildMcpServersConfig(),
          customTools,
        },
        {
          onText: (text) => {
            finalText += text;
            this.broadcast(sessionId, "builder_text", { text });
            this.saveCheckpoint(workflowRunId, cpSequence++, "assistant_message", { text });
          },
          onToolCall: (toolName, toolInput, toolUseId) => {
            // Skip custom tools — they broadcast from their own handlers
            if (["spawn_skill", "complete_workflow", "fail_workflow"].includes(toolName)) return;
            this.broadcast(sessionId, "builder_tool_call", {
              tool: toolName,
              args: toolInput,
            });
            this.saveCheckpoint(workflowRunId, cpSequence++, "tool_call", {
              toolName,
              toolInput,
              toolUseId,
            });
          },
          onToolResult: (toolName, toolUseId, resultText, isError) => {
            if (["spawn_skill", "complete_workflow", "fail_workflow"].includes(toolName)) return;
            const truncated =
              resultText.length > 500 ? resultText.slice(0, 500) + "..." : resultText;
            this.broadcast(sessionId, "builder_tool_result", {
              tool: toolName,
              result: truncated,
              isError,
            });
            this.saveCheckpoint(workflowRunId, cpSequence++, "tool_result", {
              toolName,
              toolUseId,
              result: resultText.length > 2000 ? resultText.slice(0, 2000) + "..." : resultText,
              isError,
            });
          },
        }
      );

      // Persist messages after completion (result.messages has the full conversation)
      this.builderSessionRepo.updateMessages(sessionId, result.messages);

      // Done: set status back to active (ready for next turn)
      this.builderSessionRepo.updateStatus(sessionId, "active");

      // Auto-generate title from first user message if none set
      const session = this.builderSessionRepo.findById(sessionId);
      if (session && !session.title) {
        const firstUserMsg = result.messages.find(
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
