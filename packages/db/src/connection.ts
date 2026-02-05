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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
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
  `);

  return drizzle(testSqlite, { schema });
}
