import type { Skill } from "@clawback/shared";

export interface SkillMatch {
  skill: Skill;
  confidence: number;
}

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();

  constructor(private skillsDir: string) {
    // Skills will be loaded lazily or via loadSkills()
  }

  registerSkill(skill: Skill): void {
    this.skills.set(skill.id, skill);
  }

  getSkill(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  listSkills(): Skill[] {
    return Array.from(this.skills.values());
  }

  findMatchingSkills(source: string, eventType: string): SkillMatch[] {
    const matches: SkillMatch[] = [];

    for (const skill of this.skills.values()) {
      for (const trigger of skill.triggers) {
        // Check source match
        if (trigger.source !== source && trigger.source !== "*") {
          continue;
        }

        // Check event type match
        if (trigger.events) {
          for (const pattern of trigger.events) {
            if (this.matchesEventPattern(eventType, pattern)) {
              matches.push({ skill, confidence: 1.0 });
              break;
            }
          }
        } else if (trigger.source === source) {
          // Source-only trigger matches all events from that source
          matches.push({ skill, confidence: 0.5 });
        }
      }
    }

    // Sort by confidence (highest first)
    return matches.sort((a, b) => b.confidence - a.confidence);
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
}
