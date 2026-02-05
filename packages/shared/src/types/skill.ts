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

export const SkillSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  instructions: z.string(),
  triggers: z.array(TriggerSchema),
  mcpServers: z.record(McpServerConfigSchema).default({}),
  toolPermissions: ToolPermissionsSchema.default({ allow: ["*"], deny: [] }),
  notifications: NotificationSettingsSchema.default({ onComplete: false, onError: true }),
  knowledge: z.array(z.string()).optional(),
});

export type Skill = z.infer<typeof SkillSchema>;

export const CreateSkillSchema = SkillSchema.omit({ id: true });
export type CreateSkill = z.infer<typeof CreateSkillSchema>;
