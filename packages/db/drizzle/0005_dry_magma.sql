CREATE TABLE `checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`workflow_run_id` text,
	`sequence` integer NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`state` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `hitl_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`workflow_run_id` text NOT NULL,
	`checkpoint_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`prompt` text NOT NULL,
	`context` text,
	`options` text,
	`response` text,
	`timeout_at` integer,
	`created_at` integer NOT NULL,
	`responded_at` integer,
	FOREIGN KEY (`workflow_run_id`) REFERENCES `workflow_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`checkpoint_id`) REFERENCES `checkpoints`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_scheduled_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text,
	`workflow_id` text,
	`trigger_index` integer NOT NULL,
	`schedule` text NOT NULL,
	`last_run_at` integer,
	`next_run_at` integer NOT NULL,
	`enabled` integer DEFAULT true,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `skills`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`workflow_id`) REFERENCES `workflows`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_scheduled_jobs`("id", "skill_id", "workflow_id", "trigger_index", "schedule", "last_run_at", "next_run_at", "enabled", "created_at", "updated_at") SELECT "id", "skill_id", "workflow_id", "trigger_index", "schedule", "last_run_at", "next_run_at", "enabled", "created_at", "updated_at" FROM `scheduled_jobs`;--> statement-breakpoint
DROP TABLE `scheduled_jobs`;--> statement-breakpoint
ALTER TABLE `__new_scheduled_jobs` RENAME TO `scheduled_jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;