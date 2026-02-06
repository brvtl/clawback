import Anthropic from "@anthropic-ai/sdk";
import type { Workflow, WorkflowRun, Skill, Event, SkillRunResult } from "@clawback/shared";
import type {
  WorkflowRepository,
  SkillRepository,
  RunRepository,
  EventRepository,
} from "@clawback/db";
import type { SkillExecutor } from "../skills/executor.js";

export interface WorkflowExecutorDependencies {
  workflowRepo: WorkflowRepository;
  skillRepo: SkillRepository;
  eventRepo: EventRepository;
  runRepo: RunRepository;
  skillExecutor: SkillExecutor;
  anthropicApiKey?: string;
}

// Tools available to the orchestrator AI
const ORCHESTRATOR_TOOLS: Anthropic.Tool[] = [
  {
    name: "spawn_skill",
    description:
      "Execute a skill with the given inputs. The skill will process the inputs and return results. Use this to delegate work to specialized skills.",
    input_schema: {
      type: "object" as const,
      properties: {
        skillId: {
          type: "string",
          description: "The ID of the skill to execute",
        },
        inputs: {
          type: "object",
          description:
            "Input data to pass to the skill. This will be included in the event payload.",
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
      "Mark the workflow as completed with a summary of what was accomplished. Call this when all required skills have been executed successfully.",
    input_schema: {
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
  },
  {
    name: "fail_workflow",
    description:
      "Mark the workflow as failed with an error message. Call this if a critical skill fails or the workflow cannot be completed.",
    input_schema: {
      type: "object" as const,
      properties: {
        error: {
          type: "string",
          description: "Description of why the workflow failed",
        },
        partialResults: {
          type: "object",
          description: "Any partial results that were obtained before failure",
          additionalProperties: true,
        },
      },
      required: ["error"],
    },
  },
];

export class WorkflowExecutor {
  private anthropic: Anthropic | null = null;
  private workflowRepo: WorkflowRepository;
  private skillRepo: SkillRepository;
  private eventRepo: EventRepository;
  private runRepo: RunRepository;
  private skillExecutor: SkillExecutor;

  constructor(deps: WorkflowExecutorDependencies) {
    this.workflowRepo = deps.workflowRepo;
    this.skillRepo = deps.skillRepo;
    this.eventRepo = deps.eventRepo;
    this.runRepo = deps.runRepo;
    this.skillExecutor = deps.skillExecutor;

    if (deps.anthropicApiKey) {
      this.anthropic = new Anthropic({ apiKey: deps.anthropicApiKey });
      console.log("[WorkflowExecutor] Initialized with Anthropic API key");
    } else {
      console.log(
        "[WorkflowExecutor] WARNING: No ANTHROPIC_API_KEY configured - workflows will not run"
      );
    }
  }

  async execute(workflow: Workflow, event: Event): Promise<WorkflowRun> {
    if (!this.anthropic) {
      throw new Error("ANTHROPIC_API_KEY environment variable is required for workflow execution");
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
    workflowRun: WorkflowRun
  ): Promise<{ output: unknown }> {
    if (!this.anthropic) {
      throw new Error("Anthropic client not initialized");
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

    let messages: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];
    const skillResults: SkillRunResult[] = [];
    let continueLoop = true;
    let finalOutput: unknown = null;

    console.log(
      `[WorkflowExecutor] Starting orchestration for workflow "${workflow.name}" with model ${model}`
    );

    while (continueLoop) {
      const response = await this.anthropic.messages.create({
        model,
        max_tokens: 4096,
        system: systemPrompt,
        tools: ORCHESTRATOR_TOOLS,
        messages,
      });

      // Check for tool use
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      if (toolUseBlocks.length > 0) {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          /* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */
          const toolName = toolUse.name as string;
          const toolInput = toolUse.input as Record<string, unknown>;
          const toolId = toolUse.id as string;
          /* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access */

          console.log(`[WorkflowExecutor] Tool call: ${toolName}`);

          let result: string;
          let isError = false;

          if (toolName === "spawn_skill") {
            const spawnResult = await this.handleSpawnSkill(
              toolInput,
              event,
              workflowRun,
              availableSkills
            );
            if (spawnResult.error) {
              result = JSON.stringify({ error: spawnResult.error });
              isError = true;
            } else {
              result = JSON.stringify(spawnResult.result);
              if (spawnResult.result) {
                skillResults.push(spawnResult.result);
              }
            }
          } else if (toolName === "complete_workflow") {
            const summary = toolInput.summary as string;
            const results = toolInput.results as Record<string, unknown> | undefined;
            finalOutput = {
              summary,
              results: results ?? {},
              skillRuns: skillResults,
            };
            result = JSON.stringify({ success: true, summary });
            continueLoop = false;
            console.log(`[WorkflowExecutor] Workflow completed: ${summary}`);
          } else if (toolName === "fail_workflow") {
            const error = toolInput.error as string;
            const partialResults = toolInput.partialResults as Record<string, unknown> | undefined;
            finalOutput = {
              error,
              partialResults: partialResults ?? {},
              skillRuns: skillResults,
            };
            result = JSON.stringify({ failed: true, error });
            continueLoop = false;
            console.log(`[WorkflowExecutor] Workflow failed: ${error}`);

            // Throw error to trigger failed status
            throw new Error(error);
          } else {
            result = JSON.stringify({ error: `Unknown tool: ${toolName}` });
            isError = true;
          }

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolId,
            content: result,
            is_error: isError,
          });
        }

        // Continue the conversation
        messages = [
          ...messages,
          { role: "assistant", content: response.content },
          { role: "user", content: toolResults },
        ];
      } else {
        // No tool use - check if we have a final response
        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === "text"
        );

        if (textBlocks.length > 0 && !finalOutput) {
          finalOutput = {
            summary: textBlocks.map((b) => b.text).join("\n"),
            skillRuns: skillResults,
          };
        }

        continueLoop = false;
      }

      // Safety check for stop reason
      if (response.stop_reason === "end_turn" && toolUseBlocks.length === 0) {
        continueLoop = false;
      }
    }

    return { output: finalOutput };
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
6. **Complete the workflow** - call \`complete_workflow\` with a summary when done
7. **Fail gracefully** - call \`fail_workflow\` if the workflow cannot be completed

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
