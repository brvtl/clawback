import Anthropic from "@anthropic-ai/sdk";
import { generateToolCallId, type Skill, type Event } from "@clawback/shared";
import type { RunRepository, NotificationRepository, Run } from "@clawback/db";

export interface ExecutorDependencies {
  runRepo: RunRepository;
  notifRepo: NotificationRepository;
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

  constructor(deps: ExecutorDependencies) {
    this.runRepo = deps.runRepo;
    this.notifRepo = deps.notifRepo;

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

  async runAgentLoop(skill: Skill, event: Event, run: Run): Promise<AgentLoopResult> {
    if (!this.anthropic) {
      // For testing or when API key is not available
      return {
        output: { message: "No API key configured" },
        toolCalls: [],
      };
    }

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
            // TODO: Actually call MCP tools here
            output = { message: `Tool ${toolName} executed` };
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
