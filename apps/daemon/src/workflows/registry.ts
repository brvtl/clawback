import type { Workflow, TriggerFilter } from "@clawback/shared";
import type { WorkflowRepository } from "@clawback/db";

export interface WorkflowMatch {
  workflow: Workflow;
  confidence: number;
}

export class WorkflowRegistry {
  private cache: Map<string, Workflow> = new Map();

  constructor(private workflowRepo?: WorkflowRepository) {}

  /**
   * Load all workflows from database
   */
  loadWorkflows(): void {
    this.cache.clear();

    if (this.workflowRepo) {
      const workflows = this.workflowRepo.findAll(true);
      for (const workflow of workflows) {
        this.cache.set(workflow.id, workflow);
      }
    }
  }

  /**
   * Register a workflow (adds to DB and cache)
   */
  registerWorkflow(workflow: Workflow): Workflow {
    if (this.workflowRepo) {
      const created = this.workflowRepo.create({
        name: workflow.name,
        description: workflow.description,
        instructions: workflow.instructions,
        triggers: workflow.triggers,
        skills: workflow.skills,
        orchestratorModel: workflow.orchestratorModel,
        enabled: workflow.enabled,
      });
      this.cache.set(created.id, created);
      return created;
    }

    this.cache.set(workflow.id, workflow);
    return workflow;
  }

  getWorkflow(id: string): Workflow | undefined {
    return this.cache.get(id);
  }

  listWorkflows(): Workflow[] {
    return Array.from(this.cache.values());
  }

  /**
   * Find workflows that match the given event
   */
  findMatchingWorkflows(
    source: string,
    eventType: string,
    payload?: Record<string, unknown>
  ): WorkflowMatch[] {
    const matches: WorkflowMatch[] = [];

    for (const workflow of this.cache.values()) {
      for (const trigger of workflow.triggers) {
        // Check source match
        if (trigger.source !== source && trigger.source !== "*") {
          continue;
        }

        // Check event type match
        let eventMatches = false;
        if (trigger.events) {
          for (const pattern of trigger.events) {
            if (this.matchesEventPattern(eventType, pattern)) {
              eventMatches = true;
              break;
            }
          }
        } else if (trigger.source === source) {
          eventMatches = true;
        }

        if (!eventMatches) {
          continue;
        }

        // Check filters if present
        if (trigger.filters && payload) {
          if (!this.matchesFilters(trigger.filters, payload)) {
            continue;
          }
        }

        matches.push({ workflow, confidence: trigger.filters ? 1.0 : 0.8 });
      }
    }

    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  private matchesFilters(filters: TriggerFilter, payload: Record<string, unknown>): boolean {
    if (filters.repository) {
      const repo = payload.repository as { full_name?: string } | undefined;
      if (!repo?.full_name || repo.full_name !== filters.repository) {
        return false;
      }
    }

    if (filters.ref && filters.ref.length > 0) {
      const ref = payload.ref as string | undefined;
      if (!ref || !filters.ref.includes(ref)) {
        return false;
      }
    }

    return true;
  }

  private matchesEventPattern(eventType: string, pattern: string): boolean {
    if (pattern === eventType) {
      return true;
    }

    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      return regex.test(eventType);
    }

    return false;
  }

  /**
   * Update a workflow
   */
  updateWorkflow(id: string, updates: Partial<Workflow>): Workflow | undefined {
    if (this.workflowRepo) {
      const updated = this.workflowRepo.update(id, updates);
      if (updated) {
        this.cache.set(id, updated);
      }
      return updated;
    }

    const existing = this.cache.get(id);
    if (existing) {
      const updated = { ...existing, ...updates };
      this.cache.set(id, updated);
      return updated;
    }
    return undefined;
  }

  /**
   * Delete a workflow
   */
  deleteWorkflow(id: string): boolean {
    if (this.workflowRepo) {
      const deleted = this.workflowRepo.delete(id);
      if (deleted) {
        this.cache.delete(id);
      }
      return deleted;
    }

    return this.cache.delete(id);
  }
}
