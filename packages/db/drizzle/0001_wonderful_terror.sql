CREATE TABLE `mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`command` text NOT NULL,
	`args` text DEFAULT '[]' NOT NULL,
	`env` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_servers_name_unique` ON `mcp_servers` (`name`);