import { eq, desc, and } from "drizzle-orm";
import { generateEventId } from "@clawback/shared";
import { events, type Event, type NewEvent } from "../schema.js";
import type { DatabaseConnection } from "../connection.js";

export interface CreateEventInput {
  source: string;
  type: string;
  payload: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

export interface ListEventsOptions {
  limit?: number;
  offset?: number;
  source?: string;
  status?: Event["status"];
}

export class EventRepository {
  constructor(private db: DatabaseConnection) {}

  async create(input: CreateEventInput): Promise<Event> {
    const now = Date.now();
    const event: NewEvent = {
      id: generateEventId(),
      source: input.source,
      type: input.type,
      payload: JSON.stringify(input.payload),
      metadata: JSON.stringify(input.metadata),
      status: "pending",
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(events).values(event);
    return this.toEvent(event as Event);
  }

  async findById(id: string): Promise<Event | undefined> {
    const [result] = await this.db.select().from(events).where(eq(events.id, id));
    return result ? this.toEvent(result) : undefined;
  }

  async findPending(): Promise<Event[]> {
    const results = await this.db
      .select()
      .from(events)
      .where(eq(events.status, "pending"))
      .orderBy(events.createdAt);
    return results.map((r) => this.toEvent(r));
  }

  async updateStatus(id: string, status: Event["status"]): Promise<void> {
    await this.db.update(events).set({ status, updatedAt: Date.now() }).where(eq(events.id, id));
  }

  async list(options: ListEventsOptions = {}): Promise<Event[]> {
    const { limit = 50, offset = 0, source, status } = options;

    const conditions = [];
    if (source) {
      conditions.push(eq(events.source, source));
    }
    if (status) {
      conditions.push(eq(events.status, status));
    }

    const query = this.db
      .select()
      .from(events)
      .orderBy(desc(events.createdAt))
      .limit(limit)
      .offset(offset);

    if (conditions.length > 0) {
      const results = await query.where(and(...conditions));
      return results.map((r) => this.toEvent(r));
    }

    const results = await query;
    return results.map((r) => this.toEvent(r));
  }

  private toEvent(row: Event): Event {
    return {
      ...row,
      payload: row.payload,
      metadata: row.metadata,
    };
  }
}
