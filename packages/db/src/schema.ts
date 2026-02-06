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

// Skills table - stores skill configurations
export const skills = sqliteTable("skills", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  instructions: text("instructions").notNull(),
  triggers: text("triggers").notNull(), // JSON array of triggers
  mcpServers: text("mcp_servers").notNull().default("{}"), // JSON object
  toolPermissions: text("tool_permissions").notNull().default('{"allow":["*"],"deny":[]}'), // JSON
  notifications: text("notifications_config")
    .notNull()
    .default('{"onComplete":false,"onError":true}'), // JSON
  knowledge: text("knowledge"), // JSON array of file paths
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  source: text("source", { enum: ["file", "api", "remote"] })
    .notNull()
    .default("api"), // Where skill was created
  filePath: text("file_path"), // Original file path if loaded from disk
  // Remote skill fields
  sourceUrl: text("source_url"), // URL for remote skills
  isRemote: integer("is_remote", { mode: "boolean" }).default(false),
  contentHash: text("content_hash"), // SHA-256 of remote content for caching reviews
  lastFetchedAt: integer("last_fetched_at", { mode: "number" }),
  reviewStatus: text("review_status", { enum: ["pending", "approved", "rejected"] }),
  reviewResult: text("review_result"), // JSON with review details
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});

// MCP Servers table - global MCP server configurations
export const mcpServers = sqliteTable("mcp_servers", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(), // Unique name for referencing (e.g., "github", "filesystem")
  description: text("description"),
  command: text("command").notNull(), // e.g., "npx"
  args: text("args").notNull().default("[]"), // JSON array of args
  env: text("env").notNull().default("{}"), // JSON object of env vars (credentials stored here)
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});

// Scheduled Jobs table - tracks cron-triggered skill executions
export const scheduledJobs = sqliteTable("scheduled_jobs", {
  id: text("id").primaryKey(),
  skillId: text("skill_id")
    .notNull()
    .references(() => skills.id),
  triggerIndex: integer("trigger_index").notNull(), // Index of the trigger in skill.triggers array
  schedule: text("schedule").notNull(), // Cron expression
  lastRunAt: integer("last_run_at", { mode: "number" }),
  nextRunAt: integer("next_run_at", { mode: "number" }).notNull(),
  enabled: integer("enabled", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});

// Workflows table - AI-orchestrated multi-skill workflows
export const workflows = sqliteTable("workflows", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  instructions: text("instructions").notNull(), // Instructions for the orchestrator AI
  triggers: text("triggers").notNull(), // JSON array of triggers (same as skills)
  skills: text("skills").notNull(), // JSON array of skill IDs available to orchestrator
  orchestratorModel: text("orchestrator_model", { enum: ["opus", "sonnet"] })
    .notNull()
    .default("opus"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "number" }).notNull(),
  updatedAt: integer("updated_at", { mode: "number" }).notNull(),
});

// Workflow Runs table - tracks workflow executions
export const workflowRuns = sqliteTable("workflow_runs", {
  id: text("id").primaryKey(),
  workflowId: text("workflow_id")
    .notNull()
    .references(() => workflows.id),
  eventId: text("event_id")
    .notNull()
    .references(() => events.id),
  status: text("status", { enum: ["pending", "running", "completed", "failed", "cancelled"] })
    .notNull()
    .default("pending"),
  input: text("input").notNull(), // JSON string - trigger event payload
  output: text("output"), // JSON string - final result/summary
  error: text("error"),
  skillRuns: text("skill_runs").notNull().default("[]"), // JSON array of skill run IDs in order
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

export type DbSkill = typeof skills.$inferSelect;
export type NewDbSkill = typeof skills.$inferInsert;

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type DbMcpServer = typeof mcpServers.$inferSelect;
export type NewDbMcpServer = typeof mcpServers.$inferInsert;

export type ScheduledJob = typeof scheduledJobs.$inferSelect;
export type NewScheduledJob = typeof scheduledJobs.$inferInsert;

export type DbWorkflow = typeof workflows.$inferSelect;
export type NewDbWorkflow = typeof workflows.$inferInsert;

export type WorkflowRun = typeof workflowRuns.$inferSelect;
export type NewWorkflowRun = typeof workflowRuns.$inferInsert;
