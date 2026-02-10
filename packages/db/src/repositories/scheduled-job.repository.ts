import { eq, lte, and, desc } from "drizzle-orm";
import { generateScheduledJobId } from "@clawback/shared";
import {
  scheduledJobs,
  skills,
  workflows,
  type ScheduledJob,
  type NewScheduledJob,
} from "../schema.js";
import type { DatabaseConnection } from "../connection.js";

export interface CreateScheduledJobInput {
  skillId?: string; // Either skillId or workflowId required
  workflowId?: string; // Either skillId or workflowId required
  triggerIndex: number;
  schedule: string;
  nextRunAt: number;
  enabled?: boolean;
}

export interface EnrichedScheduledJob extends ScheduledJob {
  skillName?: string;
  workflowName?: string;
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
    if (!input.skillId && !input.workflowId) {
      throw new Error("Either skillId or workflowId is required");
    }
    const now = Date.now();
    const job: NewScheduledJob = {
      id: generateScheduledJobId(),
      skillId: input.skillId,
      workflowId: input.workflowId,
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

  findByWorkflowId(workflowId: string): ScheduledJob[] {
    return this.db
      .select()
      .from(scheduledJobs)
      .where(eq(scheduledJobs.workflowId, workflowId))
      .all();
  }

  findByWorkflowAndTrigger(workflowId: string, triggerIndex: number): ScheduledJob | undefined {
    return this.db
      .select()
      .from(scheduledJobs)
      .where(
        and(eq(scheduledJobs.workflowId, workflowId), eq(scheduledJobs.triggerIndex, triggerIndex))
      )
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

  findAllEnriched(): EnrichedScheduledJob[] {
    // Get all jobs with skill names (left join)
    const jobsWithSkills = this.db
      .select({
        job: scheduledJobs,
        skillName: skills.name,
      })
      .from(scheduledJobs)
      .leftJoin(skills, eq(scheduledJobs.skillId, skills.id))
      .orderBy(desc(scheduledJobs.nextRunAt))
      .all();

    // Get workflow names for workflow jobs
    const workflowIds = jobsWithSkills
      .filter((j) => j.job.workflowId)
      .map((j) => j.job.workflowId as string);

    const workflowNames = new Map<string, string>();
    if (workflowIds.length > 0) {
      const wfs = this.db.select({ id: workflows.id, name: workflows.name }).from(workflows).all();
      for (const wf of wfs) {
        if (workflowIds.includes(wf.id)) {
          workflowNames.set(wf.id, wf.name);
        }
      }
    }

    return jobsWithSkills.map((row): EnrichedScheduledJob => {
      const enriched: EnrichedScheduledJob = { ...row.job };
      if (row.skillName) {
        enriched.skillName = row.skillName;
      }
      if (row.job.workflowId) {
        const wfName = workflowNames.get(row.job.workflowId);
        if (wfName) {
          enriched.workflowName = wfName;
        }
      }
      return enriched;
    });
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

  deleteByWorkflowId(workflowId: string): number {
    const result = this.db
      .delete(scheduledJobs)
      .where(eq(scheduledJobs.workflowId, workflowId))
      .run();
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
