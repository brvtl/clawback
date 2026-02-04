import { eq, desc, and } from "drizzle-orm";
import { generateRunId } from "@clawback/shared";
import { runs, type Run, type NewRun } from "../schema.js";
import type { DatabaseConnection } from "../connection.js";

export interface CreateRunInput {
  eventId: string;
  skillId: string;
  parentRunId?: string;
  input: Record<string, unknown>;
}

export interface ToolCallRecord {
  id: string;
  name: string;
  input: Record<string, unknown>;
  output: Record<string, unknown> | null;
  error: string | null;
  startedAt: Date;
  completedAt: Date | null;
}

export interface ListRunsOptions {
  limit?: number;
  offset?: number;
  skillId?: string;
  status?: Run["status"];
}

export class RunRepository {
  constructor(private db: DatabaseConnection) {}

  async create(input: CreateRunInput): Promise<Run> {
    const now = Date.now();
    const run: NewRun = {
      id: generateRunId(),
      eventId: input.eventId,
      skillId: input.skillId,
      parentRunId: input.parentRunId ?? null,
      status: "pending",
      input: JSON.stringify(input.input),
      output: null,
      error: null,
      toolCalls: "[]",
      startedAt: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(runs).values(run);
    return run as Run;
  }

  async findById(id: string): Promise<Run | undefined> {
    const [result] = await this.db.select().from(runs).where(eq(runs.id, id));
    return result;
  }

  async findByEvent(eventId: string): Promise<Run[]> {
    return this.db.select().from(runs).where(eq(runs.eventId, eventId)).orderBy(runs.createdAt);
  }

  async updateStatus(
    id: string,
    status: Run["status"],
    output?: Record<string, unknown>,
    error?: string
  ): Promise<void> {
    const now = Date.now();
    const updates: Partial<NewRun> = {
      status,
      updatedAt: now,
    };

    if (status === "running") {
      updates.startedAt = now;
    }

    if (status === "completed" || status === "failed" || status === "cancelled") {
      updates.completedAt = now;
    }

    if (output !== undefined) {
      updates.output = JSON.stringify(output);
    }

    if (error !== undefined) {
      updates.error = error;
    }

    await this.db.update(runs).set(updates).where(eq(runs.id, id));
  }

  async addToolCall(id: string, toolCall: ToolCallRecord): Promise<void> {
    const run = await this.findById(id);
    if (!run) {
      throw new Error(`Run not found: ${id}`);
    }

    const existingCalls = JSON.parse(run.toolCalls ?? "[]") as ToolCallRecord[];
    existingCalls.push(toolCall);

    await this.db
      .update(runs)
      .set({
        toolCalls: JSON.stringify(existingCalls),
        updatedAt: Date.now(),
      })
      .where(eq(runs.id, id));
  }

  async list(options: ListRunsOptions = {}): Promise<Run[]> {
    const { limit = 50, offset = 0, skillId, status } = options;

    const conditions = [];
    if (skillId) {
      conditions.push(eq(runs.skillId, skillId));
    }
    if (status) {
      conditions.push(eq(runs.status, status));
    }

    const query = this.db
      .select()
      .from(runs)
      .orderBy(desc(runs.createdAt))
      .limit(limit)
      .offset(offset);

    if (conditions.length > 0) {
      return query.where(and(...conditions));
    }

    return query;
  }
}
