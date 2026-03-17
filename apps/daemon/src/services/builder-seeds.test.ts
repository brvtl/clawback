import { describe, it, expect, beforeEach } from "vitest";
import { seedBuilderSkills, getBuilderOrchestratorInstructions } from "./builder-seeds.js";
import { SkillRepository, createTestConnection } from "@clawback/db";

const EXPECTED_SKILL_NAMES = [
  "Builder: Query System",
  "Builder: Research",
  "Builder: Setup Integration",
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
      const skill = skillRepo.findBuiltin(name);
      expect(skill).toBeDefined();
    }
  });

  it("skills are marked as built-in", () => {
    seedBuilderSkills(skillRepo);
    for (const name of EXPECTED_SKILL_NAMES) {
      const skill = skillRepo.findBuiltin(name);
      expect(skill!.isBuiltin).toBe(true);
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
    const modified = skillRepo.findBuiltin(targetName);
    expect(modified!.instructions).toBe("custom instructions overwrite");

    // Re-seed should restore original instructions
    seedBuilderSkills(skillRepo);
    const restored = skillRepo.findBuiltin(targetName);
    expect(restored!.instructions).not.toBe("custom instructions overwrite");
    expect(restored!.instructions.length).toBeGreaterThan(0);
  });

  it("built-in skills cannot be deleted", () => {
    const skillMap = seedBuilderSkills(skillRepo);
    for (const name of EXPECTED_SKILL_NAMES) {
      const id = skillMap.get(name)!;
      const result = skillRepo.delete(id);
      expect(result).toBe(false);
    }
  });

  it("Setup Integration skill uses clawback MCP server", () => {
    seedBuilderSkills(skillRepo);
    const skill = skillRepo.findBuiltin("Builder: Setup Integration");
    expect(skill).toBeDefined();
    expect(skill!.mcpServers).toContain("clawback");
  });

  it("renames old skill name to new name preserving ID", () => {
    // Create a skill with the old name
    const oldSkill = skillRepo.createBuiltin({
      name: "Builder: Create MCP Server",
      description: "old desc",
      instructions: "old instructions",
      mcpServers: ["clawback"],
      toolPermissions: { allow: [], deny: [] },
      model: "sonnet",
    });
    const oldId = oldSkill.id;

    // Seed should rename it
    const skillMap = seedBuilderSkills(skillRepo);
    const newId = skillMap.get("Builder: Setup Integration");

    expect(newId).toBe(oldId);
    expect(skillRepo.findBuiltin("Builder: Create MCP Server")).toBeUndefined();
    expect(skillRepo.findBuiltin("Builder: Setup Integration")).toBeDefined();
  });
});

describe("getBuilderOrchestratorInstructions", () => {
  it("contains injected skill IDs", () => {
    const skillMap = new Map([["Builder: Query System", "skill_abc"]]);
    const output = getBuilderOrchestratorInstructions(skillMap, new Map());
    expect(output).toContain("skill_abc");
  });

  it("contains skill names", () => {
    const skillMap = new Map([["Builder: Query System", "skill_abc"]]);
    const output = getBuilderOrchestratorInstructions(skillMap, new Map());
    expect(output).toContain("Builder: Query System");
  });

  it("contains spawn_skill reference", () => {
    const skillMap = new Map([["Builder: Query System", "skill_abc"]]);
    const output = getBuilderOrchestratorInstructions(skillMap, new Map());
    expect(output).toContain("spawn_skill");
  });

  it("contains complete_workflow reference", () => {
    const skillMap = new Map([["Builder: Query System", "skill_abc"]]);
    const output = getBuilderOrchestratorInstructions(skillMap, new Map());
    expect(output).toContain("complete_workflow");
  });

  it("contains credential handling guidance", () => {
    const skillMap = new Map([["Builder: Query System", "skill_abc"]]);
    const output = getBuilderOrchestratorInstructions(skillMap, new Map());
    expect(output).toContain("Credential Handling");
  });

  it("returns non-empty string when passed empty map", () => {
    const output = getBuilderOrchestratorInstructions(new Map(), new Map());
    expect(typeof output).toBe("string");
    expect(output.length).toBeGreaterThan(0);
  });

  it("contains Clawback concepts section", () => {
    const skillMap = new Map([["Builder: Query System", "skill_abc"]]);
    const output = getBuilderOrchestratorInstructions(skillMap, new Map());
    expect(output).toContain("Clawback Concepts");
  });

  it("lists MCP server names and tool names when provided", () => {
    const skillMap = new Map([["Builder: Query System", "skill_abc"]]);
    const mcpTools = new Map([
      ["github", ["mcp__github__list_pull_requests", "mcp__github__create_issue"]],
      ["slack", ["mcp__slack__post_message"]],
    ]);
    const output = getBuilderOrchestratorInstructions(skillMap, mcpTools);
    expect(output).toContain("github");
    expect(output).toContain("slack");
    expect(output).toContain("mcp__github__list_pull_requests");
    expect(output).toContain("mcp__slack__post_message");
    expect(output).toContain("Direct Tool Access");
  });

  it("lists server name without tools when tools array is empty", () => {
    const mcpTools = new Map([["email", [] as string[]]]);
    const output = getBuilderOrchestratorInstructions(new Map(), mcpTools);
    expect(output).toContain("**email**");
    expect(output).not.toContain("No external MCP integrations");
  });

  it("shows no-integrations message when no MCP servers", () => {
    const output = getBuilderOrchestratorInstructions(new Map(), new Map());
    expect(output).toContain("No external MCP integrations are currently configured");
  });

  it("contains MCP server setup guidance with curated integrations", () => {
    const output = getBuilderOrchestratorInstructions(new Map(), new Map());
    expect(output).toContain("MCP Server Setup");
    expect(output).toContain("Builder: Setup Integration");
    expect(output).toContain("curated list of supported integrations");
  });
});
