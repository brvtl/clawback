import { z } from "zod";

export const ScheduledJobSchema = z.object({
  id: z.string(),
  skillId: z.string().nullable().optional(), // nullable - either skillId or workflowId
  workflowId: z.string().nullable().optional(), // nullable - either skillId or workflowId
  triggerIndex: z.number(),
  schedule: z.string(), // Cron expression
  lastRunAt: z.number().nullable().optional(),
  nextRunAt: z.number(),
  enabled: z.boolean().nullable().default(true),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type ScheduledJob = z.infer<typeof ScheduledJobSchema>;

export const CreateScheduledJobSchema = ScheduledJobSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type CreateScheduledJob = z.infer<typeof CreateScheduledJobSchema>;

// Cron event payload when a scheduled job fires
export const CronEventPayloadSchema = z.object({
  timestamp: z.string(), // ISO timestamp
  schedule: z.string(), // Cron expression
  skillId: z.string().optional(), // Optional - either skillId or workflowId
  workflowId: z.string().optional(), // Optional - either skillId or workflowId
  jobId: z.string(),
});

export type CronEventPayload = z.infer<typeof CronEventPayloadSchema>;
