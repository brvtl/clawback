import { describe, it, expect } from "vitest";
import { SkillSchema, type Skill, TriggerSchema } from "./skill.js";

describe("Skill", () => {
  it("should validate a valid skill", () => {
    const skill: Skill = {
      id: "github-pr-reviewer",
      name: "GitHub PR Reviewer",
      description: "Reviews pull requests and provides feedback",
      instructions: "Review the PR and suggest improvements",
      triggers: [
        {
          source: "github",
          events: ["pull_request.opened", "pull_request.synchronize"],
        },
      ],
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_TOKEN: "${GITHUB_TOKEN}" },
        },
      },
      toolPermissions: {
        allow: ["github:*"],
        deny: ["github:delete_*"],
      },
      notifications: {
        onComplete: true,
        onError: true,
      },
    };

    const result = SkillSchema.safeParse(skill);
    expect(result.success).toBe(true);
  });

  it("should require id and name", () => {
    const invalid = {
      description: "A skill without id or name",
    };

    const result = SkillSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("should allow minimal skill with defaults", () => {
    const minimal = {
      id: "simple-skill",
      name: "Simple Skill",
      instructions: "Do something simple",
      triggers: [],
    };

    const result = SkillSchema.safeParse(minimal);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mcpServers).toEqual({});
      expect(result.data.notifications).toEqual({ onComplete: false, onError: true });
    }
  });
});

describe("Trigger", () => {
  it("should validate a trigger with source and events", () => {
    const trigger = {
      source: "github",
      events: ["push", "pull_request"],
    };

    const result = TriggerSchema.safeParse(trigger);
    expect(result.success).toBe(true);
  });

  it("should allow cron triggers", () => {
    const trigger = {
      source: "cron",
      schedule: "0 9 * * 1-5",
    };

    const result = TriggerSchema.safeParse(trigger);
    expect(result.success).toBe(true);
  });
});
