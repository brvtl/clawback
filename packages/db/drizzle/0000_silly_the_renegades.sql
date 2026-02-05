CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`metadata` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`message` text NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`skill_id` text NOT NULL,
	`parent_run_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`input` text NOT NULL,
	`output` text,
	`error` text,
	`tool_calls` text DEFAULT '[]' NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`instructions` text NOT NULL,
	`triggers` text NOT NULL,
	`mcp_servers` text DEFAULT '{}' NOT NULL,
	`tool_permissions` text DEFAULT '{"allow":["*"],"deny":[]}' NOT NULL,
	`notifications_config` text DEFAULT '{"onComplete":false,"onError":true}' NOT NULL,
	`knowledge` text,
	`enabled` integer DEFAULT true NOT NULL,
	`source` text DEFAULT 'api' NOT NULL,
	`file_path` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
