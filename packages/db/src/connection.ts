import Database from "better-sqlite3";
import { drizzle, BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema.js";

export type DatabaseConnection = BetterSQLite3Database<typeof schema>;

let db: DatabaseConnection | null = null;
let sqlite: Database.Database | null = null;

export function createConnection(dbPath: string): DatabaseConnection {
  if (db) {
    return db;
  }

  sqlite = new Database(dbPath);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");

  db = drizzle(sqlite, { schema });
  return db;
}

export function getConnection(): DatabaseConnection {
  if (!db) {
    throw new Error("Database not initialized. Call createConnection first.");
  }
  return db;
}

export function closeConnection(): void {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    db = null;
  }
}

// For testing - creates an in-memory database
export function createTestConnection(): DatabaseConnection {
  const testSqlite = new Database(":memory:");
  testSqlite.pragma("foreign_keys = ON");

  // Create tables for testing
  testSqlite.exec(`
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      metadata TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      parent_run_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      input TEXT NOT NULL,
      output TEXT,
      error TEXT,
      tool_calls TEXT NOT NULL DEFAULT '[]',
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (event_id) REFERENCES events(id)
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      instructions TEXT NOT NULL,
      triggers TEXT NOT NULL,
      mcp_servers TEXT NOT NULL DEFAULT '{}',
      tool_permissions TEXT NOT NULL DEFAULT '{"allow":["*"],"deny":[]}',
      notifications_config TEXT NOT NULL DEFAULT '{"onComplete":false,"onError":true}',
      knowledge TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      source TEXT NOT NULL DEFAULT 'api',
      file_path TEXT,
      source_url TEXT,
      is_remote INTEGER DEFAULT 0,
      content_hash TEXT,
      last_fetched_at INTEGER,
      review_status TEXT,
      review_result TEXT,
      model TEXT DEFAULT 'sonnet',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scheduled_jobs (
      id TEXT PRIMARY KEY,
      skill_id TEXT,
      workflow_id TEXT,
      trigger_index INTEGER NOT NULL,
      schedule TEXT NOT NULL,
      last_run_at INTEGER,
      next_run_at INTEGER NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (skill_id) REFERENCES skills(id),
      FOREIGN KEY (workflow_id) REFERENCES workflows(id)
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      skill_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      read INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id)
    );

    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      command TEXT NOT NULL,
      args TEXT NOT NULL DEFAULT '[]',
      env TEXT NOT NULL DEFAULT '{}',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      instructions TEXT NOT NULL,
      triggers TEXT NOT NULL,
      skills TEXT NOT NULL,
      orchestrator_model TEXT NOT NULL DEFAULT 'opus',
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      input TEXT NOT NULL,
      output TEXT,
      error TEXT,
      skill_runs TEXT NOT NULL DEFAULT '[]',
      started_at INTEGER,
      completed_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (workflow_id) REFERENCES workflows(id),
      FOREIGN KEY (event_id) REFERENCES events(id)
    );

    CREATE TABLE IF NOT EXISTS checkpoints (
      id TEXT PRIMARY KEY,
      run_id TEXT,
      workflow_run_id TEXT,
      sequence INTEGER NOT NULL,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      state TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id),
      FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id)
    );

    CREATE TABLE IF NOT EXISTS builder_sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'active',
      messages TEXT NOT NULL DEFAULT '[]',
      title TEXT,
      last_error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS hitl_requests (
      id TEXT PRIMARY KEY,
      workflow_run_id TEXT NOT NULL,
      checkpoint_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      prompt TEXT NOT NULL,
      context TEXT,
      options TEXT,
      response TEXT,
      timeout_at INTEGER,
      created_at INTEGER NOT NULL,
      responded_at INTEGER,
      FOREIGN KEY (workflow_run_id) REFERENCES workflow_runs(id),
      FOREIGN KEY (checkpoint_id) REFERENCES checkpoints(id)
    );
  `);

  return drizzle(testSqlite, { schema });
}
