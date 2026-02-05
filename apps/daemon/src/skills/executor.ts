import Anthropic from "@anthropic-ai/sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { generateToolCallId, type Skill, type Event } from "@clawback/shared";
import type { RunRepository, NotificationRepository, Run, McpServerRepository } from "@clawback/db";
import { McpManager, type ToolPermissions } from "../mcp/manager.js";

export type ClaudeBackend = "api" | "sdk" | "auto";

export interface ExecutorDependencies {
  runRepo: RunRepository;
  notifRepo: NotificationRepository;
  mcpServerRepo: McpServerRepository;
  mcpManager: McpManager;
  anthropicApiKey?: string;
  claudeBackend?: ClaudeBackend;
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
  private claudeBackend: ClaudeBackend;

  constructor(deps: ExecutorDependencies) {
    this.runRepo = deps.runRepo;
    this.notifRepo = deps.notifRepo;
    this.mcpServerRepo = deps.mcpServerRepo;
    this.mcpManager = deps.mcpManager;
    this.claudeBackend = deps.claudeBackend ?? "auto";

    if (deps.anthropicApiKey) {
      this.anthropic = new Anthropic({ apiKey: deps.anthropicApiKey });
    }
  }

  async execute(skill: Skill, event: Event): Promise<Run> {
    // Parse event payload
    const payload = (
      typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload
    ) as Record<string, unknown>;

    // Create run record
    const run = await this.runRepo.create({
      eventId: event.id,
      skillId: skill.id,
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
      const result = await this.runAgentLoop(skill, event, run);

      // Update status to completed
      await this.runRepo.updateStatus(run.id, "completed", result.output, undefined);

      // Send notification if configured
      if (skill.notifications?.onComplete) {
        await this.notifRepo.create({
          runId: run.id,
          skillId: skill.id,
          type: "success",
          title: `${skill.name} completed`,
          message: `Successfully processed ${event.type} event`,
        });
      }

      return { ...run, status: "completed", output: JSON.stringify(result.output) };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";

      // Update status to failed
      await this.runRepo.updateStatus(run.id, "failed", undefined, errorMessage);

      // Send error notification if configured
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

  private shouldUseSdk(): boolean {
    if (this.claudeBackend === "sdk") return true;
    if (this.claudeBackend === "api") return false;
    // "auto" mode: prefer SDK, fall back to API if SDK not available
    return true; // Try SDK first in auto mode
  }

  async runAgentLoop(skill: Skill, event: Event, run: Run): Promise<AgentLoopResult> {
    // Determine which backend to use
    const useSdk = this.shouldUseSdk();

    if (useSdk) {
      try {
        return await this.runWithSdk(skill, event, run);
      } catch (error) {
        // If SDK fails and we're in auto mode with API key available, fall back
        if (this.claudeBackend === "auto" && this.anthropic) {
          console.warn("SDK execution failed, falling back to API:", error);
          return await this.runWithApi(skill, event, run);
        }
        throw error;
      }
    }

    // Use API
    if (!this.anthropic) {
      return {
        output: { message: "No API key configured and SDK not available" },
        toolCalls: [],
      };
    }

    return await this.runWithApi(skill, event, run);
  }

  async runWithSdk(skill: Skill, event: Event, _run: Run): Promise<AgentLoopResult> {
    const toolCalls: ToolCallResult[] = [];

    // Build the prompt
    const eventPayload = (
      typeof event.payload === "string" ? JSON.parse(event.payload) : event.payload
    ) as Record<string, unknown>;

    const systemContext = this.buildSystemPrompt(skill, event);
    const userPrompt = `${systemContext}\n\n---\n\nProcess this ${event.type} event from ${event.source}:\n\n${JSON.stringify(eventPayload, null, 2)}`;

    // Determine allowed tools from skill config
    const allowedTools: string[] = [];
    if (skill.toolPermissions?.allow) {
      // Map MCP server tools to SDK tool names
      for (const pattern of skill.toolPermissions.allow) {
        if (pattern === "*") {
          // Allow common tools
          allowedTools.push("Read", "Write", "Edit", "Bash", "Glob", "Grep");
        } else {
          allowedTools.push(pattern);
        }
      }
    }

    // Build MCP server config for SDK
    // Supports two formats:
    // 1. Array of strings: ["github", "filesystem"] - references global servers
    // 2. Object with inline configs: { github: { command: ... } } - inline definitions
    const mcpServers: Record<
      string,
      { type: "stdio"; command: string; args: string[]; env?: Record<string, string> }
    > = {};

    if (skill.mcpServers) {
      // Check if it's an array (global server references)
      if (Array.isArray(skill.mcpServers)) {
        for (const serverName of skill.mcpServers) {
          const globalServer = this.mcpServerRepo.findByName(serverName);
          if (globalServer?.enabled) {
            mcpServers[serverName] = {
              type: "stdio",
              command: globalServer.command,
              args: globalServer.args,
              env: globalServer.env,
            };
          } else {
            console.warn(`MCP server "${serverName}" not found or disabled`);
          }
        }
      } else {
        // Object with inline configs
        for (const [name, config] of Object.entries(skill.mcpServers)) {
          // Check if this is a reference to a global server (string value)
          if (typeof config === "string") {
            const globalServer = this.mcpServerRepo.findByName(config);
            if (globalServer?.enabled) {
              mcpServers[name] = {
                type: "stdio",
                command: globalServer.command,
                args: globalServer.args,
                env: globalServer.env,
              };
            }
          } else {
            // Inline config - resolve ${VAR} placeholders in env values
            const resolvedConfig = this.mcpManager.resolveEnvVars({
              command: config.command,
              args: config.args ?? [],
              env: config.env,
            });
            mcpServers[name] = {
              type: "stdio",
              command: resolvedConfig.command,
              args: resolvedConfig.args,
              env: resolvedConfig.env,
            };
          }
        }
      }
    }

    let finalResponse = "";

    // Run the query using Claude Agent SDK
    const q = query({
      prompt: userPrompt,
      options: {
        model: "claude-sonnet-4-20250514",
        allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
        mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined,
      },
    });

    // Process the async generator
    // The SDK yields messages with dynamic types - need to use type assertions
    for await (const message of q) {
      if (message.type === "assistant") {
        // Extract text from assistant messages
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        const content = (message as { message: { content: unknown } }).message.content;
        if (Array.isArray(content)) {
          for (const block of content as Array<{ type: string; text?: string }>) {
            if (block.type === "text" && block.text) {
              finalResponse += block.text;
            }
          }
        }
      } else if (message.type === "tool_use") {
        // Record tool calls
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const msg = message as { name?: string; input?: unknown };
        const toolCall: ToolCallResult = {
          id: generateToolCallId(),
          name: msg.name ?? "unknown",
          input: (msg.input as Record<string, unknown>) ?? {},
          output: null,
          error: null,
          startedAt: new Date(),
          completedAt: new Date(),
        };
        toolCalls.push(toolCall);
      } else if (message.type === "tool_result") {
        // Update the last tool call with results
        if (toolCalls.length > 0) {
          const lastToolCall = toolCalls[toolCalls.length - 1];
          lastToolCall.completedAt = new Date();
          if (message.is_error) {
            lastToolCall.error = String(message.content);
          } else {
            lastToolCall.output = { result: message.content };
          }
        }
      } else if (message.type === "result") {
        // Final result
        if (message.result) {
          finalResponse = String(message.result);
        }
      }
    }

    return {
      output: { response: finalResponse },
      toolCalls,
    };
  }

  async runWithApi(skill: Skill, event: Event, run: Run): Promise<AgentLoopResult> {
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
