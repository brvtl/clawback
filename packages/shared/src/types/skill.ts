import { z } from "zod";

export const McpServerConfigSchema = z.object({
  command: z.string(),
  args: z.array(z.string()).default([]),
  env: z.record(z.string()).default({}),
});

export type McpServerConfig = z.infer<typeof McpServerConfigSchema>;

export const ToolPermissionsSchema = z.object({
  allow: z.array(z.string()).default(["*"]),
  deny: z.array(z.string()).default([]),
});

export type ToolPermissions = z.infer<typeof ToolPermissionsSchema>;

export const NotificationSettingsSchema = z.object({
  onComplete: z.boolean().default(false),
  onError: z.boolean().default(true),
});

export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;

export const TriggerFilterSchema = z.object({
  repository: z.string().optional(),
  ref: z.array(z.string()).optional(),
});

export type TriggerFilter = z.infer<typeof TriggerFilterSchema>;

export const TriggerSchema = z.object({
  source: z.string(),
  events: z.array(z.string()).optional(),
  schedule: z.string().optional(),
  filters: TriggerFilterSchema.optional(),
});

export type Trigger = z.infer<typeof TriggerSchema>;

// MCP servers can be:
// 1. Array of strings (global server references): ["github", "filesystem"]
// 2. Record of configs (inline definitions): { github: { command: "npx", ... } }
export const McpServersSchema = z
  .union([
    z.array(z.string()), // Global server references
    z.record(McpServerConfigSchema), // Inline configs
  ])
  .default({});

export const ReviewStatusSchema = z.enum(["pending", "approved", "rejected"]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const ReviewResultSchema = z.object({
  approved: z.boolean(),
  concerns: z.array(z.string()).default([]),
  riskLevel: z.enum(["low", "medium", "high"]).optional(),
  summary: z.string().optional(),
  reviewedAt: z.number().optional(),
});
export type ReviewResult = z.infer<typeof ReviewResultSchema>;

// Model selection for skill execution
export const SkillModelSchema = z.enum(["opus", "sonnet", "haiku"]);
export type SkillModel = z.infer<typeof SkillModelSchema>;

export const SkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  instructions: z.string(),
  triggers: z.array(TriggerSchema),
  mcpServers: McpServersSchema,
  toolPermissions: ToolPermissionsSchema.default({ allow: ["*"], deny: [] }),
  notifications: NotificationSettingsSchema.default({ onComplete: false, onError: true }),
  knowledge: z.array(z.string()).optional(),
  // Remote skill fields
  sourceUrl: z.string().optional(),
  isRemote: z.boolean().default(false),
  contentHash: z.string().optional(),
  lastFetchedAt: z.number().optional(),
  reviewStatus: ReviewStatusSchema.optional(),
  reviewResult: ReviewResultSchema.optional(),
  // Model selection
  model: SkillModelSchema.default("sonnet"),
});

export type Skill = z.infer<typeof SkillSchema>;

export const CreateSkillSchema = SkillSchema.omit({ id: true });
export type CreateSkill = z.infer<typeof CreateSkillSchema>;
