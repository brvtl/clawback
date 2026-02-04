import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

// Events table - stores incoming webhooks and scheduled events
export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  source: text("source").notNull(), // github, slack, cron, etc.
  type: text("type").notNull(), // push, pull_request.opened, etc.
  payload: text("payload").notNull(), // JSON string
  metadata: text("metadata").notNull(), // JSON string (headers, delivery IDs, etc.)
  status: text("status", { enum: ["pending", "processing", "completed", "failed"] })
    .notNull()
    .default("pending"),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});

// Runs table - tracks skill executions
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  skillId: text("skill_id").notNull(),
  parentRunId: text("parent_run_id"), // For sub-skill spawning
  status: text("status", { enum: ["pending", "running", "completed", "failed", "cancelled"] })
    .notNull()
    .default("pending"),
  input: text("input").notNull(), // JSON string
  output: text("output"), // JSON string
  error: text("error"),
  toolCalls: text("tool_calls").notNull().default("[]"), // JSON array
  startedAt: integer("started_at", { mode: "number" }),
  completedAt: integer("completed_at", { mode: "number" }),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});

// Notifications table - user notifications
export const notifications = sqliteTable("notifications", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => runs.id),
  skillId: text("skill_id").notNull(),
  type: text("type", { enum: ["success", "error", "info", "warning"] }).notNull(),
  title: text("title").notNull(),
  message: text("message").notNull(),
  read: integer("read", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
});

// Type exports for use with Drizzle
export type Event = typeof events.$inferSelect;
export type NewEvent = typeof events.$inferInsert;

export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
