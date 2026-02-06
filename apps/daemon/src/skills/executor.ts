import Anthropic from "@anthropic-ai/sdk";
import {
  generateToolCallId,
  type Skill,
  type Event,
  type ToolPermissions as SharedToolPermissions,
} from "@clawback/shared";
import type {
  RunRepository,
  NotificationRepository,
  Run,
  McpServerRepository,
  SkillRepository,
} from "@clawback/db";
import { McpManager, type ToolPermissions } from "../mcp/manager.js";
import type { RemoteSkillFetcher } from "../services/remote-skill-fetcher.js";
import type { SkillReviewer } from "../services/skill-reviewer.js";

// Default restricted permissions for remote skills
const REMOTE_SKILL_PERMISSIONS: SharedToolPermissions = {
  allow: ["Read", "Glob", "Grep", "WebFetch", "WebSearch"],
  deny: ["Write", "Edit", "Bash", "mcp__*"],
};

export interface ExecutorDependencies {
  runRepo: RunRepository;
  notifRepo: NotificationRepository;
  mcpServerRepo: McpServerRepository;
  mcpManager: McpManager;
  skillRepo?: SkillRepository;
  remoteSkillFetcher?: RemoteSkillFetcher;
  skillReviewer?: SkillReviewer;
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
  private anthropic: Anthropic | null = null;
  private runRepo: RunRepository;
  private notifRepo: NotificationRepository;
  private mcpServerRepo: McpServerRepository;
  private mcpManager: McpManager;
  private skillRepo?: SkillRepository;
  private remoteSkillFetcher?: RemoteSkillFetcher;
  private skillReviewer?: SkillReviewer;

  constructor(deps: ExecutorDependencies) {
    this.runRepo = deps.runRepo;
    this.notifRepo = deps.notifRepo;
    this.mcpServerRepo = deps.mcpServerRepo;
    this.mcpManager = deps.mcpManager;
    this.skillRepo = deps.skillRepo;
    this.remoteSkillFetcher = deps.remoteSkillFetcher;
    this.skillReviewer = deps.skillReviewer;

    if (deps.anthropicApiKey) {
      this.anthropic = new Anthropic({ apiKey: deps.anthropicApiKey });
    } else {
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

  async runAgentLoop(skill: Skill, event: Event, run: Run): Promise<AgentLoopResult> {
    if (!this.anthropic) {
      return {
        output: { message: "No API key configured" },
        toolCalls: [],
      };
    }

    // Setup MCP servers if the skill has any configured
    if (skill.mcpServers && Object.keys(skill.mcpServers).length > 0) {
      this.mcpManager.setupServersForSkill(skill.mcpServers);
    }

    // Build tool permissions from skill config
    const toolPermissions: ToolPermissions = {
      allow: skill.toolPermissions?.allow ?? [],
      deny: skill.toolPermissions?.deny ?? [],
    };

    const systemPrompt = this.buildSystemPrompt(skill, event);
    const toolCalls: ToolCallResult[] = [];

    // Build initial message
    const eventPayload = (
      typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload
    ) as Record<string, unknown>;
    const userMessage = `Process this ${event.type} event from ${event.source}:\n\n${JSON.stringify(eventPayload, null, 2)}`;

    let messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];
    let continueLoop = true;
    let finalOutput: Record<string, unknown> = {};

    while (continueLoop) {
      const response = await this.anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: systemPrompt,
        messages,
      });

      // Check if we need to handle tool use
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      if (toolUseBlocks.length > 0) {
        // Process tool calls
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          // ESLint has trouble with Anthropic SDK type guards
          /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
          const toolName = toolUse.name as string;
          const toolInput = toolUse.input as Record<string, unknown>;
          const toolId = toolUse.id as string;
          /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

          const startedAt = new Date();
          let output: Record<string, unknown> | null = null;
          let error: string | null = null;

          try {
            // Call tool through MCP manager
            output = this.mcpManager.callTool(toolName, toolInput, toolPermissions);
          } catch (e) {
            error = e instanceof Error ? e.message : "Tool execution failed";
          }

          const completedAt = new Date();
          const toolCallResult: ToolCallResult = {
            id: generateToolCallId(),
            name: toolName,
            input: toolInput,
            output,
            error,
            startedAt,
            completedAt,
          };

          toolCalls.push(toolCallResult);
          await this.runRepo.addToolCall(run.id, toolCallResult);

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolId,
            content: error ?? JSON.stringify(output),
            is_error: error !== null,
          });
        }

        // Add assistant message and tool results to continue the loop
        messages = [
          ...messages,
          { role: "assistant", content: response.content },
          { role: "user", content: toolResults },
        ];
      } else {
        // No more tool use, extract final response
        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === "text"
        );

        finalOutput = {
          response: textBlocks.map((b) => b.text).join("\n"),
        };
        continueLoop = false;
      }

      // Check stop reason
      if (response.stop_reason === "end_turn" && toolUseBlocks.length === 0) {
        continueLoop = false;
      }
    }

    return { output: finalOutput, toolCalls };
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
