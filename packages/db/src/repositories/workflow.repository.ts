import { eq } from "drizzle-orm";
import {
  workflows,
  workflowRuns,
  type DbWorkflow,
  type WorkflowRun as DbWorkflowRun,
} from "../schema.js";
import type { DatabaseConnection } from "../connection.js";
import type {
  Workflow,
  WorkflowRun,
  Trigger,
  OrchestratorModel,
  WorkflowRunStatus,
} from "@clawback/shared";
import { generateWorkflowId, generateWorkflowRunId } from "@clawback/shared";

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  instructions: string;
  triggers: Trigger[];
  skills: string[];
  orchestratorModel?: OrchestratorModel;
  enabled?: boolean;
}

export interface UpdateWorkflowInput {
  name?: string;
  description?: string;
  instructions?: string;
  triggers?: Trigger[];
  skills?: string[];
  orchestratorModel?: OrchestratorModel;
  enabled?: boolean;
}

export interface CreateWorkflowRunInput {
  workflowId: string;
  eventId: string;
  input: unknown;
}

export class WorkflowRepository {
  constructor(private db: DatabaseConnection) {}

  private toDomain(dbWorkflow: DbWorkflow): Workflow {
    return {
      id: dbWorkflow.id,
      name: dbWorkflow.name,
      description: dbWorkflow.description ?? undefined,
      instructions: dbWorkflow.instructions,
      triggers: JSON.parse(dbWorkflow.triggers) as Trigger[],
      skills: JSON.parse(dbWorkflow.skills) as string[],
      orchestratorModel: dbWorkflow.orchestratorModel,
      enabled: dbWorkflow.enabled ?? true,
      createdAt: dbWorkflow.createdAt,
      updatedAt: dbWorkflow.updatedAt,
    };
  }

  private runToDomain(dbRun: DbWorkflowRun): WorkflowRun {
    return {
      id: dbRun.id,
      workflowId: dbRun.workflowId,
      eventId: dbRun.eventId,
      status: dbRun.status,
      input: JSON.parse(dbRun.input),
      output: dbRun.output ? JSON.parse(dbRun.output) : undefined,
      error: dbRun.error ?? undefined,
      skillRuns: JSON.parse(dbRun.skillRuns) as string[],
      startedAt: dbRun.startedAt ?? undefined,
      completedAt: dbRun.completedAt ?? undefined,
      createdAt: dbRun.createdAt,
      updatedAt: dbRun.updatedAt,
    };
  }

  create(input: CreateWorkflowInput): Workflow {
    const id = generateWorkflowId();
    const now = Date.now();

    const dbWorkflow: typeof workflows.$inferInsert = {
      id,
      name: input.name,
      description: input.description,
      instructions: input.instructions,
      triggers: JSON.stringify(input.triggers),
      skills: JSON.stringify(input.skills),
      orchestratorModel: input.orchestratorModel ?? "opus",
      enabled: input.enabled ?? true,
      createdAt: now,
      updatedAt: now,
    };

    this.db.insert(workflows).values(dbWorkflow).run();

    return this.toDomain({ ...dbWorkflow, enabled: true } as DbWorkflow);
  }

  findById(id: string): Workflow | undefined {
    const result = this.db.select().from(workflows).where(eq(workflows.id, id)).get();
    return result ? this.toDomain(result) : undefined;
  }

  findAll(enabledOnly = true): Workflow[] {
    let query = this.db.select().from(workflows);
    if (enabledOnly) {
      query = query.where(eq(workflows.enabled, true)) as typeof query;
    }
    const results = query.all();
    return results.map((r) => this.toDomain(r));
  }

  update(id: string, input: UpdateWorkflowInput): Workflow | undefined {
    const existing = this.db.select().from(workflows).where(eq(workflows.id, id)).get();
    if (!existing) {
      return undefined;
    }

    const updates: Partial<typeof workflows.$inferInsert> = {
      updatedAt: Date.now(),
    };

    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.instructions !== undefined) updates.instructions = input.instructions;
    if (input.triggers !== undefined) updates.triggers = JSON.stringify(input.triggers);
    if (input.skills !== undefined) updates.skills = JSON.stringify(input.skills);
    if (input.orchestratorModel !== undefined) updates.orchestratorModel = input.orchestratorModel;
    if (input.enabled !== undefined) updates.enabled = input.enabled;

    this.db.update(workflows).set(updates).where(eq(workflows.id, id)).run();

    return this.findById(id);
  }

  delete(id: string): boolean {
    const result = this.db.delete(workflows).where(eq(workflows.id, id)).run();
    return result.changes > 0;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const result = this.db
      .update(workflows)
      .set({ enabled, updatedAt: Date.now() })
      .where(eq(workflows.id, id))
      .run();
    return result.changes > 0;
  }

  // Workflow Run methods

  createRun(input: CreateWorkflowRunInput): WorkflowRun {
    const id = generateWorkflowRunId();
    const now = Date.now();

    const dbRun: typeof workflowRuns.$inferInsert = {
      id,
      workflowId: input.workflowId,
      eventId: input.eventId,
      status: "pending",
      input: JSON.stringify(input.input),
      skillRuns: "[]",
      createdAt: now,
      updatedAt: now,
    };

    this.db.insert(workflowRuns).values(dbRun).run();

    return this.runToDomain(dbRun as DbWorkflowRun);
  }

  findRunById(id: string): WorkflowRun | undefined {
    const result = this.db.select().from(workflowRuns).where(eq(workflowRuns.id, id)).get();
    return result ? this.runToDomain(result) : undefined;
  }

  findRunsByWorkflowId(workflowId: string): WorkflowRun[] {
    const results = this.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.workflowId, workflowId))
      .all();
    return results.map((r) => this.runToDomain(r));
  }

  updateRunStatus(
    id: string,
    status: WorkflowRunStatus,
    updates?: { output?: unknown; error?: string }
  ): WorkflowRun | undefined {
    const existing = this.db.select().from(workflowRuns).where(eq(workflowRuns.id, id)).get();
    if (!existing) {
      return undefined;
    }

    const now = Date.now();
    const dbUpdates: Partial<typeof workflowRuns.$inferInsert> = {
      status,
      updatedAt: now,
    };

    if (status === "running" && !existing.startedAt) {
      dbUpdates.startedAt = now;
    }

    if (status === "completed" || status === "failed" || status === "cancelled") {
      dbUpdates.completedAt = now;
    }

    if (updates?.output !== undefined) {
      dbUpdates.output = JSON.stringify(updates.output);
    }

    if (updates?.error !== undefined) {
      dbUpdates.error = updates.error;
    }

    this.db.update(workflowRuns).set(dbUpdates).where(eq(workflowRuns.id, id)).run();

    return this.findRunById(id);
  }

  addSkillRun(workflowRunId: string, skillRunId: string): WorkflowRun | undefined {
    const existing = this.db
      .select()
      .from(workflowRuns)
      .where(eq(workflowRuns.id, workflowRunId))
      .get();
    if (!existing) {
      return undefined;
    }

    const skillRuns = JSON.parse(existing.skillRuns) as string[];
    skillRuns.push(skillRunId);

    this.db
      .update(workflowRuns)
      .set({
        skillRuns: JSON.stringify(skillRuns),
        updatedAt: Date.now(),
      })
      .where(eq(workflowRuns.id, workflowRunId))
      .run();

    return this.findRunById(workflowRunId);
  }
}
