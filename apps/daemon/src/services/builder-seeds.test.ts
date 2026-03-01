import { describe, it, expect, beforeEach } from "vitest";
import { seedBuilderSkills, getBuilderOrchestratorInstructions } from "./builder-seeds.js";
import { SkillRepository, createTestConnection } from "@clawback/db";

const EXPECTED_SKILL_NAMES = [
  "Builder: Query System",
  "Builder: Research",
  "Builder: Create MCP Server",
  "Builder: Create Skill",
  "Builder: Create Workflow",
];

describe("seedBuilderSkills", () => {
  let skillRepo: SkillRepository;

  beforeEach(() => {
    const db = createTestConnection();
    skillRepo = new SkillRepository(db);
  });

  it("returns map with 5 entries", () => {
    const skillMap = seedBuilderSkills(skillRepo);
    expect(skillMap.size).toBe(5);
  });

  it("map has correct skill names as keys", () => {
    const skillMap = seedBuilderSkills(skillRepo);
    for (const name of EXPECTED_SKILL_NAMES) {
      expect(skillMap.has(name)).toBe(true);
    }
  });

  it("skills exist in DB after seeding", () => {
    seedBuilderSkills(skillRepo);
    for (const name of EXPECTED_SKILL_NAMES) {
      const skill = skillRepo.findSystem(name);
      expect(skill).toBeDefined();
    }
  });

  it("skills are marked as system", () => {
    seedBuilderSkills(skillRepo);
    for (const name of EXPECTED_SKILL_NAMES) {
      const skill = skillRepo.findSystem(name);
      expect(skill!.system).toBe(true);
    }
  });

  it("is idempotent - second call returns same IDs", () => {
    const firstMap = seedBuilderSkills(skillRepo);
    const secondMap = seedBuilderSkills(skillRepo);

    expect(secondMap.size).toBe(5);
    for (const name of EXPECTED_SKILL_NAMES) {
      expect(secondMap.get(name)).toBe(firstMap.get(name));
    }
  });

  it("restores instructions when re-seeded after manual update", () => {
    const firstMap = seedBuilderSkills(skillRepo);
    const targetName = "Builder: Query System";
    const id = firstMap.get(targetName)!;

    // Manually overwrite instructions
    skillRepo.update(id, { instructions: "custom instructions overwrite" });
    const modified = skillRepo.findSystem(targetName);
    expect(modified!.instructions).toBe("custom instructions overwrite");

    // Re-seed should restore original instructions
    seedBuilderSkills(skillRepo);
    const restored = skillRepo.findSystem(targetName);
    expect(restored!.instructions).not.toBe("custom instructions overwrite");
    expect(restored!.instructions.length).toBeGreaterThan(0);
  });

  it("system skills cannot be deleted", () => {
    const skillMap = seedBuilderSkills(skillRepo);
    for (const name of EXPECTED_SKILL_NAMES) {
      const id = skillMap.get(name)!;
      const result = skillRepo.delete(id);
      expect(result).toBe(false);
    }
  });
});

describe("getBuilderOrchestratorInstructions", () => {
  it("contains injected skill IDs", () => {
    const skillMap = new Map([["Builder: Query System", "skill_abc"]]);
    const output = getBuilderOrchestratorInstructions(skillMap);
    expect(output).toContain("skill_abc");
  });

  it("contains skill names", () => {
    const skillMap = new Map([["Builder: Query System", "skill_abc"]]);
    const output = getBuilderOrchestratorInstructions(skillMap);
    expect(output).toContain("Builder: Query System");
  });

  it("contains spawn_skill reference", () => {
    const skillMap = new Map([["Builder: Query System", "skill_abc"]]);
    const output = getBuilderOrchestratorInstructions(skillMap);
    expect(output).toContain("spawn_skill");
  });

  it("contains complete_workflow reference", () => {
    const skillMap = new Map([["Builder: Query System", "skill_abc"]]);
    const output = getBuilderOrchestratorInstructions(skillMap);
    expect(output).toContain("complete_workflow");
  });

  it("contains credential flow guidance", () => {
    const skillMap = new Map([["Builder: Query System", "skill_abc"]]);
    const output = getBuilderOrchestratorInstructions(skillMap);
    expect(output).toContain("Credential & State Flow");
  });

  it("returns non-empty string when passed empty map", () => {
    const output = getBuilderOrchestratorInstructions(new Map());
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("contains architecture section", () => {
    const skillMap = new Map([["Builder: Query System", "skill_abc"]]);
    const output = getBuilderOrchestratorInstructions(skillMap);
    expect(output).toContain("Clawback Architecture");
  });
});
