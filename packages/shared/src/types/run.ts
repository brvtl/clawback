import { z } from "zod";

export const RunStatusSchema = z.enum(["pending", "running", "completed", "failed", "cancelled"]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

export const ToolCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  input: z.record(z.unknown()),
  output: z.record(z.unknown()).nullable(),
  error: z.string().nullable(),
  startedAt: z.date(),
  completedAt: z.date().nullable(),
});

export type ToolCall = z.infer<typeof ToolCallSchema>;

export const RunSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  skillId: z.string(),
  parentRunId: z.string().nullable(),
  status: RunStatusSchema,
  input: z.record(z.unknown()),
  output: z.record(z.unknown()).nullable(),
  error: z.string().nullable(),
  toolCalls: z.array(ToolCallSchema).default([]),
  startedAt: z.date().nullable(),
  completedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Run = z.infer<typeof RunSchema>;

export const CreateRunSchema = RunSchema.omit({
  id: true,
  status: true,
  output: true,
  error: true,
  toolCalls: true,
  startedAt: true,
  completedAt: true,
  createdAt: true,
  updatedAt: true,
});

export type CreateRun = z.infer<typeof CreateRunSchema>;
