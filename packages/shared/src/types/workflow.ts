import { z } from "zod";
import { TriggerSchema } from "./skill.js";

export const OrchestratorModelSchema = z.enum(["opus", "sonnet"]);
export type OrchestratorModel = z.infer<typeof OrchestratorModelSchema>;

export const WorkflowSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  instructions: z.string(), // Instructions for the orchestrator AI
  triggers: z.array(TriggerSchema),
  skills: z.array(z.string()), // Skill IDs available to the orchestrator
  orchestratorModel: OrchestratorModelSchema.default("opus"),
  enabled: z.boolean().default(true),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

export type Workflow = z.infer<typeof WorkflowSchema>;

export const CreateWorkflowSchema = WorkflowSchema.omit({ id: true });
export type CreateWorkflow = z.infer<typeof CreateWorkflowSchema>;

export const UpdateWorkflowSchema = WorkflowSchema.partial().omit({ id: true });
export type UpdateWorkflow = z.infer<typeof UpdateWorkflowSchema>;

// Workflow run status
export const WorkflowRunStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "failed",
  "cancelled",
  "waiting_for_input",
]);
export type WorkflowRunStatus = z.infer<typeof WorkflowRunStatusSchema>;

// Skill run result (returned by spawn_skill tool)
export const SkillRunResultSchema = z.object({
  runId: z.string(),
  skillId: z.string(),
  skillName: z.string(),
  status: z.enum(["completed", "failed"]),
  output: z.unknown().optional(),
  error: z.string().optional(),
});
export type SkillRunResult = z.infer<typeof SkillRunResultSchema>;

export const WorkflowRunSchema = z.object({
  id: z.string(),
  workflowId: z.string(),
  eventId: z.string(),
  status: WorkflowRunStatusSchema,
  input: z.unknown(), // Trigger event payload
  output: z.unknown().optional(), // Final result/summary
  error: z.string().optional(),
  skillRuns: z.array(z.string()).default([]), // Run IDs in execution order
  startedAt: z.number().optional(),
  completedAt: z.number().optional(),
  createdAt: z.number().optional(),
  updatedAt: z.number().optional(),
});

export type WorkflowRun = z.infer<typeof WorkflowRunSchema>;
