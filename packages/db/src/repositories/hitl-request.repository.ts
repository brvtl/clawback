import { eq } from "drizzle-orm";
import { hitlRequests, type HitlRequest } from "../schema.js";
import type { DatabaseConnection } from "../connection.js";
import { generateHitlRequestId } from "@clawback/shared";

export interface CreateHitlRequestInput {
  workflowRunId: string;
  checkpointId: string;
  prompt: string;
  context?: unknown;
  options?: string[];
  timeoutAt?: number;
}

export class HitlRequestRepository {
  constructor(private db: DatabaseConnection) {}

  create(input: CreateHitlRequestInput): HitlRequest {
    const id = generateHitlRequestId();
    const now = Date.now();

    const record: typeof hitlRequests.$inferInsert = {
      id,
      workflowRunId: input.workflowRunId,
      checkpointId: input.checkpointId,
      status: "pending",
      prompt: input.prompt,
      context: input.context ? JSON.stringify(input.context) : null,
      options: input.options ? JSON.stringify(input.options) : null,
      timeoutAt: input.timeoutAt ?? null,
      createdAt: now,
    };

    this.db.insert(hitlRequests).values(record).run();

    return record as HitlRequest;
  }

  findById(id: string): HitlRequest | undefined {
    return this.db.select().from(hitlRequests).where(eq(hitlRequests.id, id)).get();
  }

  findPending(): HitlRequest[] {
    return this.db.select().from(hitlRequests).where(eq(hitlRequests.status, "pending")).all();
  }

  findByWorkflowRunId(workflowRunId: string): HitlRequest[] {
    return this.db
      .select()
      .from(hitlRequests)
      .where(eq(hitlRequests.workflowRunId, workflowRunId))
      .all();
  }

  respond(id: string, response: string): HitlRequest | undefined {
    const existing = this.findById(id);
    if (!existing || existing.status !== "pending") {
      return undefined;
    }

    const now = Date.now();
    this.db
      .update(hitlRequests)
      .set({
        status: "responded",
        response,
        respondedAt: now,
      })
      .where(eq(hitlRequests.id, id))
      .run();

    return this.findById(id);
  }

  cancel(id: string): HitlRequest | undefined {
    const existing = this.findById(id);
    if (!existing || existing.status !== "pending") {
      return undefined;
    }

    this.db.update(hitlRequests).set({ status: "cancelled" }).where(eq(hitlRequests.id, id)).run();

    return this.findById(id);
  }
}
