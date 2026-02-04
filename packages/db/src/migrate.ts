import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "path";

const dbPath = process.env.DATABASE_URL ?? "./clawback.db";

const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

const db = drizzle(sqlite);

// Run migrations
migrate(db, { migrationsFolder: resolve(import.meta.dirname, "../drizzle") });

console.info(`Migrations applied to ${dbPath}`);

sqlite.close();
