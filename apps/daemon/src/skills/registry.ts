import type { Skill, TriggerFilter } from "@clawback/shared";
import type { SkillRepository } from "@clawback/db";
import { loadSkillFromFile } from "./loader.js";
import { readdir } from "fs/promises";
import { join } from "path";

export interface SkillMatch {
  skill: Skill;
  confidence: number;
}

export interface EventContext {
  source: string;
  type: string;
  payload: Record<string, unknown>;
}

export class SkillRegistry {
  private cache: Map<string, Skill> = new Map();

  constructor(
    private skillsDir: string,
    private skillRepo?: SkillRepository
  ) {}

  /**
   * Load all skills from database and sync with file system
   */
  async loadSkills(): Promise<void> {
    // Clear cache
    this.cache.clear();

    // Load from database if available
    if (this.skillRepo) {
      const dbSkills = this.skillRepo.findAll(true);
      for (const skill of dbSkills) {
        this.cache.set(skill.id, skill);
      }
    }

    // Sync skills from file system
    await this.syncFromFileSystem();
  }

  /**
   * Sync skills from the skills directory to the database
   */
  private async syncFromFileSystem(): Promise<void> {
    try {
      const entries = await readdir(this.skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillPath = join(this.skillsDir, entry.name, "SKILL.md");
        try {
          const skill = await loadSkillFromFile(skillPath);

          if (this.skillRepo) {
            // Upsert to database
            const dbSkill = this.skillRepo.upsertFromFile(skillPath, {
              name: skill.name,
              description: skill.description,
              instructions: skill.instructions,
              triggers: skill.triggers,
              mcpServers: skill.mcpServers,
              toolPermissions: skill.toolPermissions,
              notifications: skill.notifications,
              knowledge: skill.knowledge,
            });
            this.cache.set(dbSkill.id, dbSkill);
          } else {
            // No database, just cache in memory
            this.cache.set(skill.id, skill);
          }
        } catch {
          // Skip directories without valid SKILL.md
          continue;
        }
      }
    } catch {
      // Skills directory doesn't exist or isn't readable
    }
  }

  /**
   * Register a skill (adds to DB and cache)
   */
  registerSkill(skill: Skill): Skill {
    if (this.skillRepo) {
      const created = this.skillRepo.create({
        name: skill.name,
        description: skill.description,
        instructions: skill.instructions,
        triggers: skill.triggers,
        mcpServers: skill.mcpServers,
        toolPermissions: skill.toolPermissions,
        notifications: skill.notifications,
        knowledge: skill.knowledge,
        // Remote skill fields
        sourceUrl: skill.sourceUrl,
        isRemote: skill.isRemote,
        contentHash: skill.contentHash,
        reviewStatus: skill.reviewStatus,
        reviewResult: skill.reviewResult,
      });
      this.cache.set(created.id, created);
      return created;
    }

    // No database, just cache
    this.cache.set(skill.id, skill);
    return skill;
  }

  getSkill(id: string): Skill | undefined {
    return this.cache.get(id);
  }

  listSkills(): Skill[] {
    return Array.from(this.cache.values());
  }

  findMatchingSkills(
    source: string,
    eventType: string,
    payload?: Record<string, unknown>
  ): SkillMatch[] {
    const matches: SkillMatch[] = [];

    // Special handling for cron events - match by skillId in payload
    if (source === "cron" && eventType === "scheduled" && payload?.skillId) {
      const skillId = payload.skillId as string;
      const skill = this.cache.get(skillId);
      if (skill) {
        return [{ skill, confidence: 1.0 }];
      }
      return [];
    }

    for (const skill of this.cache.values()) {
      for (const trigger of skill.triggers) {
        // Check source match
        if (trigger.source !== source && trigger.source !== "*") {
          continue;
        }

        // Skip cron triggers for non-cron sources (cron events handled above)
        if (trigger.source === "cron") {
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
          // Source-only trigger matches all events from that source
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

        matches.push({ skill, confidence: trigger.filters ? 1.0 : 0.8 });
      }
    }

    // Sort by confidence (highest first)
    return matches.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Find skills with cron triggers (for scheduler sync)
   */
  findScheduledSkills(): Array<{ skill: Skill; triggerIndex: number; schedule: string }> {
    const results: Array<{ skill: Skill; triggerIndex: number; schedule: string }> = [];

    for (const skill of this.cache.values()) {
      for (let i = 0; i < skill.triggers.length; i++) {
        const trigger = skill.triggers[i];
        if (trigger.source === "cron" && trigger.schedule) {
          results.push({ skill, triggerIndex: i, schedule: trigger.schedule });
        }
      }
    }

    return results;
  }

  private matchesFilters(filters: TriggerFilter, payload: Record<string, unknown>): boolean {
    // Check repository filter
    if (filters.repository) {
      const repo = payload.repository as { full_name?: string } | undefined;
      if (!repo?.full_name || repo.full_name !== filters.repository) {
        return false;
      }
    }

    // Check ref filter (for push events)
    if (filters.ref && filters.ref.length > 0) {
      const ref = payload.ref as string | undefined;
      if (!ref || !filters.ref.includes(ref)) {
        return false;
      }
    }

    return true;
  }

  private matchesEventPattern(eventType: string, pattern: string): boolean {
    // Exact match
    if (pattern === eventType) {
      return true;
    }

    // Wildcard matching
    if (pattern.includes("*")) {
      const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
      return regex.test(eventType);
    }

    return false;
  }

  getSkillsDir(): string {
    return this.skillsDir;
  }

  /**
   * Update a skill
   */
  updateSkill(id: string, updates: Partial<Skill>): Skill | undefined {
    if (this.skillRepo) {
      const updated = this.skillRepo.update(id, updates);
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
   * Delete a skill
   */
  deleteSkill(id: string): boolean {
    if (this.skillRepo) {
      const deleted = this.skillRepo.delete(id);
      if (deleted) {
        this.cache.delete(id);
      }
      return deleted;
    }

    return this.cache.delete(id);
  }
}
