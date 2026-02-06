CREATE TABLE `scheduled_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`trigger_index` integer NOT NULL,
	`schedule` text NOT NULL,
	`last_run_at` integer,
	`next_run_at` integer NOT NULL,
	`enabled` integer DEFAULT true,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workflow_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_id` text NOT NULL,
	`event_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`input` text NOT NULL,
	`output` text,
	`error` text,
	`skill_runs` text DEFAULT '[]' NOT NULL,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`event_id`) REFERENCES `events`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workflows` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`instructions` text NOT NULL,
	`triggers` text NOT NULL,
	`skills` text NOT NULL,
	`orchestrator_model` text DEFAULT 'opus' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `skills` ADD `source_url` text;--> statement-breakpoint
ALTER TABLE `skills` ADD `is_remote` integer DEFAULT false;--> statement-breakpoint
ALTER TABLE `skills` ADD `content_hash` text;--> statement-breakpoint
ALTER TABLE `skills` ADD `last_fetched_at` integer;--> statement-breakpoint
ALTER TABLE `skills` ADD `review_status` text;--> statement-breakpoint
ALTER TABLE `skills` ADD `review_result` text;