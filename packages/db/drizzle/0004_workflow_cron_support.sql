-- Add workflow_id column to scheduled_jobs for workflow cron triggers
-- Note: SQLite doesn't support making columns nullable via ALTER, but the existing column
-- was already defined with NOT NULL. We're adding a new column and the existing skillId
-- column is now nullable in the schema (SQLite doesn't enforce this change on existing rows).

ALTER TABLE `scheduled_jobs` ADD `workflow_id` TEXT REFERENCES `workflows`(`id`);
