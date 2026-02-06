import type { Skill, TriggerFilter } from "@clawback/shared";
import type { SkillRepository } from "@clawback/db";

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

  constructor(private skillRepo: SkillRepository) {}

  /**
   * Load all skills from database
   */
  loadSkills(): void {
    this.cache.clear();
    const dbSkills = this.skillRepo.findAll(true);
    for (const skill of dbSkills) {
      this.cache.set(skill.id, skill);
    }
  }

  /**
   * Register a skill (adds to DB and cache)
   */
  registerSkill(skill: Skill): Skill {
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

  /**
   * Update a skill
   */
  updateSkill(id: string, updates: Partial<Skill>): Skill | undefined {
    const updated = this.skillRepo.update(id, updates);
    if (updated) {
      this.cache.set(id, updated);
    }
    return updated;
  }

  /**
   * Delete a skill
   */
  deleteSkill(id: string): boolean {
    const deleted = this.skillRepo.delete(id);
    if (deleted) {
      this.cache.delete(id);
    }
    return deleted;
  }
}
