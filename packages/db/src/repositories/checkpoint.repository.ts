import { eq, asc } from "drizzle-orm";
import { checkpoints, type Checkpoint } from "../schema.js";
import type { DatabaseConnection } from "../connection.js";
import { generateCheckpointId } from "@clawback/shared";

export interface CreateCheckpointInput {
  runId?: string;
  workflowRunId?: string;
  sequence: number;
  type: Checkpoint["type"];
  data: unknown;
  state?: unknown;
}

export class CheckpointRepository {
  constructor(private db: DatabaseConnection) {}

  create(input: CreateCheckpointInput): Checkpoint {
    const id = generateCheckpointId();
    const now = Date.now();

    const record: typeof checkpoints.$inferInsert = {
      id,
      runId: input.runId ?? null,
      workflowRunId: input.workflowRunId ?? null,
      sequence: input.sequence,
      type: input.type,
      data: JSON.stringify(input.data),
      state: input.state ? JSON.stringify(input.state) : null,
      createdAt: now,
    };

    this.db.insert(checkpoints).values(record).run();

    return record as Checkpoint;
  }

  findById(id: string): Checkpoint | undefined {
    return this.db.select().from(checkpoints).where(eq(checkpoints.id, id)).get();
  }

  findByRunId(runId: string): Checkpoint[] {
    return this.db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.runId, runId))
      .orderBy(asc(checkpoints.sequence))
      .all();
  }

  findByWorkflowRunId(workflowRunId: string): Checkpoint[] {
    return this.db
      .select()
      .from(checkpoints)
      .where(eq(checkpoints.workflowRunId, workflowRunId))
      .orderBy(asc(checkpoints.sequence))
      .all();
  }

  getNextSequence(runId?: string, workflowRunId?: string): number {
    const condition = runId
      ? eq(checkpoints.runId, runId)
      : workflowRunId
        ? eq(checkpoints.workflowRunId, workflowRunId)
        : undefined;

    if (!condition) return 0;

    const result = this.db
      .select()
      .from(checkpoints)
      .where(condition)
      .orderBy(asc(checkpoints.sequence))
      .all();

    return result.length;
  }
}
