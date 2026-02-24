import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import micromatch from "micromatch";
import {
  type Skill,
  type Event,
  type ToolPermissions as SharedToolPermissions,
  type SkillModel,
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
  haiku: "claude-haiku-4-5-20251001",
};

// Retry Anthropic API calls on rate limit (429) with exponential backoff
export async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  label = "API call"
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const isRateLimit =
        err instanceof Anthropic.RateLimitError ||
        (err instanceof Error && err.message.includes("429"));
      if (!isRateLimit || attempt === maxRetries) {
        throw err;
      }
      // Parse retry-after header if available, otherwise exponential backoff
      const waitMs = Math.min(15_000 * 2 ** attempt, 120_000);
      console.log(
        `[Retry] ${label} rate limited (attempt ${attempt + 1}/${maxRetries}), waiting ${Math.round(waitMs / 1000)}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw new Error("Unreachable");
}

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

interface McpConnection {
  client: Client;
  transport: StdioClientTransport;
  serverName: string;
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

    const anthropic = new Anthropic({ apiKey: this.anthropicApiKey });
    const mcpConnections: McpConnection[] = [];
    const toolCalls: ToolCallResult[] = [];

    try {
      // Connect to MCP servers and discover tools
      const mcpServerConfigs = this.buildMcpServersConfig(skill);
      const allTools: Anthropic.Tool[] = [];
      const clientMap = new Map<string, Client>();

      for (const [serverName, config] of Object.entries(mcpServerConfigs)) {
        try {
          const resolvedEnv = this.resolveEnvVars(config.env);
          const transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: { ...process.env, ...resolvedEnv } as Record<string, string>,
          });

          const client = new Client({ name: `clawback-skill-${skill.id}`, version: "1.0.0" });
          await client.connect(transport);
          mcpConnections.push({ client, transport, serverName });
          clientMap.set(serverName, client);

          // Discover tools from this server
          const { tools } = await client.listTools();
          for (const tool of tools) {
            const namespacedName = `mcp__${serverName}__${tool.name}`;

            // Apply tool permissions filtering
            if (!this.isToolAllowed(namespacedName, skill.toolPermissions)) {
              continue;
            }

            allTools.push({
              name: namespacedName,
              description: tool.description ?? "",
              input_schema: tool.inputSchema as Anthropic.Tool["input_schema"],
            });
          }

          console.log(
            `[SkillExecutor] Connected to MCP server "${serverName}" with ${tools.length} tools`
          );
        } catch (err) {
          console.warn(
            `[SkillExecutor] Failed to connect to MCP server "${serverName}":`,
            err instanceof Error ? err.message : err
          );
        }
      }

      // Build system prompt and user message
      const systemPrompt = this.buildSystemPrompt(skill, event);
      const eventPayload = (
        typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload
      ) as Record<string, unknown>;

      const userMessage = `${systemPrompt}

---

Process this ${event.type} event from ${event.source}:

\`\`\`json
${JSON.stringify(eventPayload, null, 2)}
\`\`\``;

      const modelId = MODEL_IDS[skill.model ?? "sonnet"];
      console.log(
        `[SkillExecutor] Running skill "${skill.name}" with model ${skill.model ?? "sonnet"} (${modelId}) and ${allTools.length} tools from ${mcpConnections.length} MCP servers`
      );

      // Run Anthropic message loop
      let messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];
      let finalResponse = "";
      let continueLoop = true;
      let cpSequence = 0;

      while (continueLoop) {
        const response: Anthropic.Message = await callWithRetry(
          () =>
            anthropic.messages.create({
              model: modelId,
              max_tokens: 4096,
              tools: allTools.length > 0 ? allTools : undefined,
              messages,
            }),
          3,
          `skill "${skill.name}"`
        );

        // Process text blocks
        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === "text"
        );
        if (textBlocks.length > 0) {
          const text = textBlocks.map((b) => b.text).join("\n");
          finalResponse += text;
          this.saveCheckpoint(_run.id, cpSequence++, "assistant_message", { text });
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
            const toolId = toolUse.id;

            // Checkpoint tool call
            this.saveCheckpoint(_run.id, cpSequence++, "tool_call", {
              toolName,
              toolInput,
              toolUseId: toolId,
            });

            // Parse namespaced tool name: mcp__<server>__<tool>
            const parts = toolName.split("__");
            if (parts.length < 3 || parts[0] !== "mcp") {
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolId,
                content: JSON.stringify({ error: `Invalid tool name format: ${toolName}` }),
                is_error: true,
              });
              continue;
            }

            const serverName = parts[1]!;
            const originalToolName = parts.slice(2).join("__");
            const client = clientMap.get(serverName);

            if (!client) {
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolId,
                content: JSON.stringify({
                  error: `MCP server "${serverName}" not connected`,
                }),
                is_error: true,
              });
              continue;
            }

            const startedAt = new Date();
            let resultContent: string;
            let isError = false;

            try {
              const mcpResult = await client.callTool({
                name: originalToolName,
                arguments: toolInput,
              });

              // Extract text content from MCP result
              if (mcpResult.isError) {
                isError = true;
                resultContent = this.extractMcpResultText(mcpResult.content);
              } else {
                resultContent = this.extractMcpResultText(mcpResult.content);
              }
            } catch (err) {
              isError = true;
              resultContent = JSON.stringify({
                error: err instanceof Error ? err.message : "Tool call failed",
              });
            }

            const completedAt = new Date();

            // Track tool call
            toolCalls.push({
              id: toolId,
              name: toolName,
              input: toolInput,
              output: isError ? null : this.tryParseJson(resultContent),
              error: isError ? resultContent : null,
              startedAt,
              completedAt,
            });

            // Checkpoint tool result
            this.saveCheckpoint(_run.id, cpSequence++, "tool_result", {
              toolName,
              toolUseId: toolId,
              result: resultContent,
              isError,
            });

            toolResults.push({
              type: "tool_result",
              tool_use_id: toolId,
              content: resultContent,
              is_error: isError,
            });
          }

          // Continue conversation with tool results
          messages = [
            ...messages,
            { role: "assistant", content: response.content },
            { role: "user", content: toolResults },
          ];
        } else {
          // No tool use — done
          continueLoop = false;
        }

        // Safety check
        if (response.stop_reason === "end_turn" && toolUseBlocks.length === 0) {
          continueLoop = false;
        }
      }

      return {
        output: { response: finalResponse },
        toolCalls,
      };
    } finally {
      // Close all MCP connections
      for (const conn of mcpConnections) {
        try {
          await conn.client.close();
        } catch {
          // Ignore cleanup errors
        }
      }
    }
  }

  /**
   * Extract text from MCP tool result content.
   */
  private extractMcpResultText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((item: { type?: string; text?: string }) => {
          if (item.type === "text" && item.text) return item.text;
          return JSON.stringify(item);
        })
        .join("\n");
    }
    return JSON.stringify(content);
  }

  /**
   * Try to parse a JSON string, returning null if it fails.
   */
  private tryParseJson(text: string): Record<string, unknown> | null {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { text };
    }
  }

  /**
   * Resolve ${VAR} placeholders in env vars.
   */
  private resolveEnvVars(env?: Record<string, string>): Record<string, string> {
    if (!env) return {};
    const resolved: Record<string, string> = {};
    for (const [key, value] of Object.entries(env)) {
      resolved[key] = value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
        return process.env[varName] ?? "";
      });
    }
    return resolved;
  }

  /**
   * Check if a tool is allowed based on permission patterns.
   */
  private isToolAllowed(toolName: string, permissions?: SharedToolPermissions): boolean {
    if (!permissions) return true;

    // If deny list matches, always deny
    if (permissions.deny.length > 0 && micromatch.isMatch(toolName, permissions.deny)) {
      return false;
    }

    // If allow list is empty or contains wildcard, allow
    if (permissions.allow.length === 0) return true;

    return micromatch.isMatch(toolName, permissions.allow);
  }

  /**
   * Build MCP server configuration object from skill settings.
   * Resolves server names to full configs from the database.
   */
  private buildMcpServersConfig(
    skill: Skill
  ): Record<
    string,
    { type: "stdio"; command: string; args: string[]; env?: Record<string, string> }
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
          mcpServers[serverName] = this.toSdkServerConfig(globalServer);
          console.log(`[SkillExecutor] Added MCP server: ${serverName}`);
        } else {
          console.warn(`[SkillExecutor] MCP server "${serverName}" not found or disabled`);
        }
      }
    } else {
      // Object with inline configs
      for (const [name, config] of Object.entries(skill.mcpServers)) {
        mcpServers[name] = {
          type: "stdio",
          command: config.command,
          args: Array.isArray(config.args) ? config.args : [],
          env: config.env,
        };
        console.log(`[SkillExecutor] Added inline MCP server: ${name}`);
      }
    }

    return mcpServers;
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
