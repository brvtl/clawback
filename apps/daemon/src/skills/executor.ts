import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  type Skill,
  type Event,
  type ToolPermissions as SharedToolPermissions,
  type SkillModel,
  getMcpSetupCommands,
} from "@clawback/shared";
import type {
  RunRepository,
  NotificationRepository,
  Run,
  McpServerRepository,
  SkillRepository,
  McpServer,
  CheckpointRepository,
} from "@clawback/db";
import type { RemoteSkillFetcher } from "../services/remote-skill-fetcher.js";
import type { SkillReviewer } from "../services/skill-reviewer.js";
import type { NotificationService } from "../services/notifications.js";

// Default restricted permissions for remote skills
const REMOTE_SKILL_PERMISSIONS: SharedToolPermissions = {
  allow: ["Read", "Glob", "Grep", "WebFetch", "WebSearch"],
  deny: ["Write", "Edit", "Bash", "mcp__*"],
};

// Map skill model enum to Claude model IDs
const MODEL_IDS: Record<SkillModel, string> = {
  opus: "claude-opus-4-20250514",
  sonnet: "claude-sonnet-4-20250514",
  haiku: "claude-haiku-4-20250514",
};

export interface ExecutorDependencies {
  runRepo: RunRepository;
  notifRepo: NotificationRepository;
  mcpServerRepo: McpServerRepository;
  skillRepo?: SkillRepository;
  remoteSkillFetcher?: RemoteSkillFetcher;
  skillReviewer?: SkillReviewer;
  checkpointRepo?: CheckpointRepository;
  notificationService?: NotificationService;
  anthropicApiKey?: string;
}

export interface ToolCallResult {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  startedAt: Date;
  completedAt: Date;
}

export interface AgentLoopResult {
  output: Record<string, unknown>;
  toolCalls: ToolCallResult[];
}

export class SkillExecutor {
  private runRepo: RunRepository;
  private notifRepo: NotificationRepository;
  private mcpServerRepo: McpServerRepository;
  private skillRepo?: SkillRepository;
  private remoteSkillFetcher?: RemoteSkillFetcher;
  private skillReviewer?: SkillReviewer;
  private checkpointRepo?: CheckpointRepository;
  private notificationService?: NotificationService;
  private anthropicApiKey?: string;

  constructor(deps: ExecutorDependencies) {
    this.runRepo = deps.runRepo;
    this.notifRepo = deps.notifRepo;
    this.mcpServerRepo = deps.mcpServerRepo;
    this.skillRepo = deps.skillRepo;
    this.remoteSkillFetcher = deps.remoteSkillFetcher;
    this.skillReviewer = deps.skillReviewer;
    this.checkpointRepo = deps.checkpointRepo;
    this.notificationService = deps.notificationService;
    this.anthropicApiKey = deps.anthropicApiKey;

    if (!deps.anthropicApiKey) {
      console.log("[SkillExecutor] WARNING: No ANTHROPIC_API_KEY configured - skills will not run");
    }
  }

  async execute(skill: Skill, event: Event): Promise<Run> {
    // Parse event payload
    const payload = (
      typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload
    ) as Record<string, unknown>;

    // Handle remote skills - fetch fresh content and review if needed
    let preparedSkill = skill;
    if (skill.isRemote && skill.sourceUrl) {
      try {
        preparedSkill = await this.prepareRemoteSkill(skill);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : "Remote skill preparation failed";
        console.error(`[Executor] Remote skill preparation failed for ${skill.id}:`, errorMessage);

        // Create a failed run record
        const run = await this.runRepo.create({
          eventId: event.id,
          skillId: skill.id,
          input: { event: { source: event.source, type: event.type, payload } },
        });
        await this.runRepo.updateStatus(run.id, "failed", undefined, errorMessage);

        if (skill.notifications?.onError) {
          await this.notifRepo.create({
            runId: run.id,
            skillId: skill.id,
            type: "error",
            title: `${skill.name} failed`,
            message: errorMessage,
          });
        }

        throw error;
      }
    }

    // Create run record
    const run = await this.runRepo.create({
      eventId: event.id,
      skillId: preparedSkill.id,
      input: {
        event: {
          source: event.source,
          type: event.type,
          payload,
        },
      },
    });

    try {
      // Update status to running
      await this.runRepo.updateStatus(run.id, "running");

      // Run the agent loop
      const result = await this.runAgentLoop(preparedSkill, event, run);

      // Update status to completed
      await this.runRepo.updateStatus(run.id, "completed", result.output, undefined);

      // Send notification if configured
      if (preparedSkill.notifications?.onComplete) {
        await this.notifRepo.create({
          runId: run.id,
          skillId: preparedSkill.id,
          type: "success",
          title: `${preparedSkill.name} completed`,
          message: `Successfully processed ${event.type} event`,
        });
      }

      return { ...run, status: "completed", output: JSON.stringify(result.output) };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      // Update status to failed
      await this.runRepo.updateStatus(run.id, "failed", undefined, errorMessage);

      // Send error notification if configured
      if (preparedSkill.notifications?.onError) {
        await this.notifRepo.create({
          runId: run.id,
          skillId: preparedSkill.id,
          type: "error",
          title: `${preparedSkill.name} failed`,
          message: errorMessage,
        });
      }

      throw error;
    }
  }

  private async prepareRemoteSkill(skill: Skill): Promise<Skill> {
    if (!this.remoteSkillFetcher || !this.skillReviewer || !this.skillRepo) {
      throw new Error("Remote skill services not configured");
    }

    if (!skill.sourceUrl) {
      throw new Error("Remote skill has no source URL");
    }

    console.log(`[Executor] Fetching remote skill from ${skill.sourceUrl}`);

    // Fetch fresh content
    const fetched = await this.remoteSkillFetcher.fetch(skill.sourceUrl);

    // Check if content has changed
    const contentChanged = fetched.contentHash !== skill.contentHash;
    const needsReview = contentChanged || skill.reviewStatus !== "approved";

    if (needsReview) {
      console.log(`[Executor] Remote skill content changed or needs review, running AI review`);

      // Build knowledge content for review
      let knowledgeContent: string | undefined;
      if (fetched.knowledgeFiles.size > 0) {
        knowledgeContent = Array.from(fetched.knowledgeFiles.entries())
          .map(([path, content]) => `### ${path}\n${content}`)
          .join("\n\n");
      }

      // Run AI review
      const reviewResult = await this.skillReviewer.review(fetched.contentHash, {
        instructions: fetched.skillMarkdown.instructions,
        knowledgeContent,
        toolPermissions: skill.toolPermissions,
        mcpServers: skill.mcpServers
          ? Array.isArray(skill.mcpServers)
            ? skill.mcpServers
            : Object.keys(skill.mcpServers)
          : undefined,
      });

      // Update skill with new content hash and review status
      const reviewStatus = reviewResult.approved ? "approved" : "rejected";
      this.skillRepo.updateContentHash(skill.id, fetched.contentHash);
      this.skillRepo.updateReviewStatus(skill.id, reviewStatus, reviewResult);

      if (!reviewResult.approved) {
        const concerns = reviewResult.concerns.join("; ");
        throw new Error(`Remote skill review failed: ${concerns}`);
      }

      // Update skill instructions with fresh content
      const updatedSkill: Skill = {
        ...skill,
        instructions: fetched.skillMarkdown.instructions,
        contentHash: fetched.contentHash,
        reviewStatus: "approved",
        reviewResult,
        lastFetchedAt: Date.now(),
        // Apply restricted permissions for remote skills
        toolPermissions: REMOTE_SKILL_PERMISSIONS,
      };

      return updatedSkill;
    }

    // Content hasn't changed and is approved - use with restricted permissions
    return {
      ...skill,
      toolPermissions: REMOTE_SKILL_PERMISSIONS,
    };
  }

  async runAgentLoop(skill: Skill, event: Event, _run: Run): Promise<AgentLoopResult> {
    if (!this.anthropicApiKey) {
      return {
        output: { message: "No API key configured" },
        toolCalls: [],
      };
    }

    // Build MCP server configs from skill settings
    const mcpServers = await this.buildMcpServersConfig(skill);

    const systemPrompt = this.buildSystemPrompt(skill, event);
    const toolCalls: ToolCallResult[] = [];

    // Build the full prompt
    const eventPayload = (
      typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload
    ) as Record<string, unknown>;

    const fullPrompt = `${systemPrompt}

---

Process this ${event.type} event from ${event.source}:

\`\`\`json
${JSON.stringify(eventPayload, null, 2)}
\`\`\``;

    const modelId = MODEL_IDS[skill.model ?? "sonnet"];
    console.log(
      `[SkillExecutor] Running skill "${skill.name}" with model ${skill.model ?? "sonnet"} (${modelId}) and ${Object.keys(mcpServers).length} MCP servers`
    );

    let finalResponse = "";

    try {
      // Use the Claude Agent SDK for execution with MCP tools
      const q = query({
        prompt: fullPrompt,
        options: {
          model: modelId,
          maxTurns: 20,
          // Allow all MCP tools without prompting for permissions
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          mcpServers,
        },
      });

      let cpSequence = 0;

      for await (const msg of q) {
        if (msg.type === "assistant") {
          const content = (msg as { message: { content: unknown } }).message.content;
          if (Array.isArray(content)) {
            for (const block of content as Array<{
              type: string;
              text?: string;
              name?: string;
              input?: unknown;
              id?: string;
            }>) {
              if (block.type === "text" && block.text) {
                finalResponse += block.text;
                this.saveCheckpoint(_run.id, cpSequence++, "assistant_message", {
                  text: block.text,
                });
              } else if (block.type === "tool_use") {
                this.saveCheckpoint(_run.id, cpSequence++, "tool_call", {
                  toolName: block.name,
                  toolInput: block.input,
                  toolUseId: block.id,
                });
              }
            }
          }
        } else if (msg.type === "result") {
          const resultMsg = msg as { result?: unknown };
          if (resultMsg.result) {
            finalResponse = String(resultMsg.result);
            this.saveCheckpoint(_run.id, cpSequence++, "tool_result", {
              result: resultMsg.result,
            });
          }
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Agent execution failed";
      console.error(`[SkillExecutor] Error running skill "${skill.name}":`, errorMessage);
      throw error;
    }

    return {
      output: { response: finalResponse },
      toolCalls,
    };
  }

  /**
   * Build MCP server configuration object from skill settings.
   * Resolves server names to full configs from the database.
   * Runs any required setup commands (e.g. browser installation for Playwright).
   */
  private async buildMcpServersConfig(
    skill: Skill
  ): Promise<
    Record<string, { type: "stdio"; command: string; args: string[]; env?: Record<string, string> }>
  > {
    const mcpServers: Record<
      string,
      { type: "stdio"; command: string; args: string[]; env?: Record<string, string> }
    > = {};

    if (!skill.mcpServers) {
      return mcpServers;
    }

    if (Array.isArray(skill.mcpServers)) {
      // Array of server names - resolve from global config
      for (const serverName of skill.mcpServers) {
        const globalServer = this.mcpServerRepo.findByName(serverName);
        if (globalServer?.enabled) {
          const sdkConfig = this.toSdkServerConfig(globalServer);
          mcpServers[serverName] = sdkConfig;
          console.log(`[SkillExecutor] Added MCP server: ${serverName}`);
          await this.runSetupCommands(serverName, sdkConfig.args);
        } else {
          console.warn(`[SkillExecutor] MCP server "${serverName}" not found or disabled`);
        }
      }
    } else {
      // Object with inline configs
      for (const [name, config] of Object.entries(skill.mcpServers)) {
        const args = Array.isArray(config.args) ? config.args : [];
        mcpServers[name] = {
          type: "stdio",
          command: config.command,
          args,
          env: config.env,
        };
        console.log(`[SkillExecutor] Added inline MCP server: ${name}`);
        await this.runSetupCommands(name, args);
      }
    }

    return mcpServers;
  }

  /**
   * Run setup commands for an MCP server if needed (e.g. Playwright browser install).
   */
  private async runSetupCommands(serverName: string, args: string[]): Promise<void> {
    const setupCommands = getMcpSetupCommands(args);
    if (setupCommands.length === 0) return;

    const { execSync } = await import("child_process");
    for (const cmd of setupCommands) {
      try {
        console.log(`[SkillExecutor] Running setup for ${serverName}: ${cmd}`);
        execSync(cmd, { stdio: "pipe", timeout: 120_000 });
      } catch (err) {
        console.warn(
          `[SkillExecutor] Setup command failed for ${serverName}: ${cmd}`,
          err instanceof Error ? err.message : err
        );
      }
    }
  }

  /**
   * Convert a database MCP server record to SDK config format.
   */
  private toSdkServerConfig(server: McpServer): {
    type: "stdio";
    command: string;
    args: string[];
    env?: Record<string, string>;
  } {
    return {
      type: "stdio",
      command: server.command,
      args: Array.isArray(server.args) ? server.args : [],
      env: server.env ?? undefined,
    };
  }

  private saveCheckpoint(
    runId: string,
    sequence: number,
    type: "assistant_message" | "tool_call" | "tool_result" | "error",
    data: unknown
  ): void {
    if (!this.checkpointRepo) return;

    try {
      const checkpoint = this.checkpointRepo.create({
        runId,
        sequence,
        type,
        data,
      });

      this.notificationService?.broadcastMessage({
        type: "checkpoint",
        runId,
        checkpoint: {
          id: checkpoint.id,
          sequence: checkpoint.sequence,
          type: checkpoint.type,
          data,
          createdAt: checkpoint.createdAt,
        },
      });
    } catch (err) {
      console.error("[SkillExecutor] Failed to save checkpoint:", err);
    }
  }

  buildSystemPrompt(skill: Skill, event: Event): string {
    return `You are an AI assistant executing the skill "${skill.name}".

## Instructions

${skill.instructions}

## Event Context

- Source: ${event.source}
- Type: ${event.type}
- Event ID: ${event.id}

## Guidelines

1. Analyze the event payload carefully
2. Use available tools to accomplish the task
3. Provide clear, actionable feedback
4. If you encounter errors, explain what went wrong

Execute the skill based on the event data provided.`;
  }
}
