import { eq, desc } from "drizzle-orm";
import { builderSessions, type BuilderSession } from "../schema.js";
import type { DatabaseConnection } from "../connection.js";
import { generateBuilderSessionId } from "@clawback/shared";

export type BuilderSessionStatus = "active" | "processing" | "completed" | "error";

export class BuilderSessionRepository {
  constructor(private db: DatabaseConnection) {}

  create(title?: string): BuilderSession {
    const id = generateBuilderSessionId();
    const now = Date.now();

    const session: typeof builderSessions.$inferInsert = {
      id,
      status: "active",
      messages: "[]",
      title: title ?? null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };

    this.db.insert(builderSessions).values(session).run();

    return session as BuilderSession;
  }

  findById(id: string): BuilderSession | undefined {
    return this.db.select().from(builderSessions).where(eq(builderSessions.id, id)).get();
  }

  findAll(limit = 50): BuilderSession[] {
    return this.db
      .select()
      .from(builderSessions)
      .orderBy(desc(builderSessions.updatedAt))
      .limit(limit)
      .all();
  }

  updateMessages(id: string, messages: unknown[]): void {
    this.db
      .update(builderSessions)
      .set({
        messages: JSON.stringify(messages),
        updatedAt: Date.now(),
      })
      .where(eq(builderSessions.id, id))
      .run();
  }

  updateStatus(id: string, status: BuilderSessionStatus, error?: string): void {
    const updates: Partial<typeof builderSessions.$inferInsert> = {
      status,
      updatedAt: Date.now(),
    };
    if (error !== undefined) {
      updates.lastError = error;
    }
    this.db.update(builderSessions).set(updates).where(eq(builderSessions.id, id)).run();
  }

  updateTitle(id: string, title: string): void {
    this.db
      .update(builderSessions)
      .set({ title, updatedAt: Date.now() })
      .where(eq(builderSessions.id, id))
      .run();
  }

  getMessages(id: string): unknown[] {
    const session = this.findById(id);
    if (!session) return [];
    return JSON.parse(session.messages) as unknown[];
  }

  /**
   * Reset any sessions stuck in "processing" state back to "active".
   * Called on startup to recover from interrupted sessions.
   */
  resetStale(): number {
    const result = this.db
      .update(builderSessions)
      .set({ status: "active", updatedAt: Date.now() })
      .where(eq(builderSessions.status, "processing"))
      .run();
    return result.changes;
  }
}
