import { eq, lte, and, desc } from "drizzle-orm";
import { generateScheduledJobId } from "@clawback/shared";
import { scheduledJobs, type ScheduledJob, type NewScheduledJob } from "../schema.js";
import type { DatabaseConnection } from "../connection.js";

export interface CreateScheduledJobInput {
  skillId: string;
  triggerIndex: number;
  schedule: string;
  nextRunAt: number;
  enabled?: boolean;
}

export interface UpdateScheduledJobInput {
  schedule?: string;
  nextRunAt?: number;
  lastRunAt?: number;
  enabled?: boolean;
}

export class ScheduledJobRepository {
  constructor(private db: DatabaseConnection) {}

  create(input: CreateScheduledJobInput): ScheduledJob {
    const now = Date.now();
    const job: NewScheduledJob = {
      id: generateScheduledJobId(),
      skillId: input.skillId,
      triggerIndex: input.triggerIndex,
      schedule: input.schedule,
      nextRunAt: input.nextRunAt,
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };

    this.db.insert(scheduledJobs).values(job).run();
    return job as ScheduledJob;
  }

  findById(id: string): ScheduledJob | undefined {
    return this.db.select().from(scheduledJobs).where(eq(scheduledJobs.id, id)).get();
  }

  findBySkillId(skillId: string): ScheduledJob[] {
    return this.db.select().from(scheduledJobs).where(eq(scheduledJobs.skillId, skillId)).all();
  }

  findBySkillAndTrigger(skillId: string, triggerIndex: number): ScheduledJob | undefined {
    return this.db
      .select()
      .from(scheduledJobs)
      .where(and(eq(scheduledJobs.skillId, skillId), eq(scheduledJobs.triggerIndex, triggerIndex)))
      .get();
  }

  findDue(asOf: number = Date.now()): ScheduledJob[] {
    return this.db
      .select()
      .from(scheduledJobs)
      .where(and(lte(scheduledJobs.nextRunAt, asOf), eq(scheduledJobs.enabled, true)))
      .orderBy(scheduledJobs.nextRunAt)
      .all();
  }

  findAll(): ScheduledJob[] {
    return this.db.select().from(scheduledJobs).orderBy(desc(scheduledJobs.nextRunAt)).all();
  }

  update(id: string, input: UpdateScheduledJobInput): ScheduledJob | undefined {
    const existing = this.findById(id);
    if (!existing) {
      return undefined;
    }

    const updates: Partial<NewScheduledJob> = {
      updatedAt: Date.now(),
    };

    if (input.schedule !== undefined) updates.schedule = input.schedule;
    if (input.nextRunAt !== undefined) updates.nextRunAt = input.nextRunAt;
    if (input.lastRunAt !== undefined) updates.lastRunAt = input.lastRunAt;
    if (input.enabled !== undefined) updates.enabled = input.enabled;

    this.db.update(scheduledJobs).set(updates).where(eq(scheduledJobs.id, id)).run();
    return this.findById(id);
  }

  updateAfterRun(id: string, lastRunAt: number, nextRunAt: number): ScheduledJob | undefined {
    return this.update(id, { lastRunAt, nextRunAt });
  }

  delete(id: string): boolean {
    const result = this.db.delete(scheduledJobs).where(eq(scheduledJobs.id, id)).run();
    return result.changes > 0;
  }

  deleteBySkillId(skillId: string): number {
    const result = this.db.delete(scheduledJobs).where(eq(scheduledJobs.skillId, skillId)).run();
    return result.changes;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const result = this.db
      .update(scheduledJobs)
      .set({ enabled, updatedAt: Date.now() })
      .where(eq(scheduledJobs.id, id))
      .run();
    return result.changes > 0;
  }
}
