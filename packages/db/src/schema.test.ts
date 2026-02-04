import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as schema from "./schema.js";

describe("Database Schema", () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle>;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    db = drizzle(sqlite, { schema });

    // Create tables manually for in-memory testing
    sqlite.exec(`
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
  });

  afterEach(() => {
    sqlite.close();
  });

  describe("events table", () => {
    it("should insert and retrieve an event", async () => {
      const now = Date.now();
      const event = {
        id: "evt_test123",
        source: "github",
        type: "push",
        payload: JSON.stringify({ ref: "refs/heads/main" }),
        metadata: JSON.stringify({ delivery: "abc123" }),
        status: "pending" as const,
        createdAt: now,
        updatedAt: now,
      };

      await db.insert(schema.events).values(event);
      const [retrieved] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, "evt_test123"));

      expect(retrieved).toBeDefined();
      expect(retrieved?.source).toBe("github");
      expect(retrieved?.type).toBe("push");
      expect(JSON.parse(retrieved?.payload ?? "{}")).toEqual({ ref: "refs/heads/main" });
    });

    it("should update event status", async () => {
      const now = Date.now();
      await db.insert(schema.events).values({
        id: "evt_update",
        source: "test",
        type: "test",
        payload: "{}",
        metadata: "{}",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });

      await db
        .update(schema.events)
        .set({ status: "completed", updatedAt: Date.now() })
        .where(eq(schema.events.id, "evt_update"));

      const [updated] = await db
        .select()
        .from(schema.events)
        .where(eq(schema.events.id, "evt_update"));

      expect(updated?.status).toBe("completed");
    });
  });

  describe("runs table", () => {
    it("should insert and retrieve a run with tool calls", async () => {
      const now = Date.now();

      // First insert an event
      await db.insert(schema.events).values({
        id: "evt_for_run",
        source: "test",
        type: "test",
        payload: "{}",
        metadata: "{}",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });

      const toolCalls = [{ id: "tc_1", name: "test_tool", input: {}, output: {}, error: null }];

      await db.insert(schema.runs).values({
        id: "run_test123",
        eventId: "evt_for_run",
        skillId: "test-skill",
        parentRunId: null,
        status: "running",
        input: JSON.stringify({ test: true }),
        output: null,
        error: null,
        toolCalls: JSON.stringify(toolCalls),
        startedAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      const [retrieved] = await db
        .select()
        .from(schema.runs)
        .where(eq(schema.runs.id, "run_test123"));

      expect(retrieved).toBeDefined();
      expect(retrieved?.skillId).toBe("test-skill");
      expect(JSON.parse(retrieved?.toolCalls ?? "[]")).toHaveLength(1);
    });
  });

  describe("notifications table", () => {
    it("should insert and retrieve a notification", async () => {
      const now = Date.now();

      // Create event and run first
      await db.insert(schema.events).values({
        id: "evt_notif",
        source: "test",
        type: "test",
        payload: "{}",
        metadata: "{}",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(schema.runs).values({
        id: "run_notif",
        eventId: "evt_notif",
        skillId: "test-skill",
        parentRunId: null,
        status: "completed",
        input: "{}",
        output: "{}",
        error: null,
        toolCalls: "[]",
        startedAt: now,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(schema.notifications).values({
        id: "notif_test",
        runId: "run_notif",
        skillId: "test-skill",
        type: "success",
        title: "Test Complete",
        message: "Test ran successfully",
        read: false,
        createdAt: now,
      });

      const [notification] = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.id, "notif_test"));

      expect(notification).toBeDefined();
      expect(notification?.title).toBe("Test Complete");
      expect(notification?.read).toBe(false);
    });

    it("should mark notification as read", async () => {
      const now = Date.now();

      await db.insert(schema.events).values({
        id: "evt_read",
        source: "test",
        type: "test",
        payload: "{}",
        metadata: "{}",
        status: "pending",
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(schema.runs).values({
        id: "run_read",
        eventId: "evt_read",
        skillId: "test",
        parentRunId: null,
        status: "completed",
        input: "{}",
        output: null,
        error: null,
        toolCalls: "[]",
        startedAt: now,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(schema.notifications).values({
        id: "notif_read",
        runId: "run_read",
        skillId: "test",
        type: "info",
        title: "Test",
        message: "Test",
        read: false,
        createdAt: now,
      });

      await db
        .update(schema.notifications)
        .set({ read: true })
        .where(eq(schema.notifications.id, "notif_read"));

      const [updated] = await db
        .select()
        .from(schema.notifications)
        .where(eq(schema.notifications.id, "notif_read"));

      expect(updated?.read).toBe(true);
    });
  });
});
