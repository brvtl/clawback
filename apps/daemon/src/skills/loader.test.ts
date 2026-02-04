import { describe, it, expect } from "vitest";
import { parseSkillConfig, parseSkillMarkdown } from "./loader.js";

describe("SkillLoader", () => {
  describe("parseSkillMarkdown", () => {
    it("should parse a skill markdown file with frontmatter", () => {
      const content = `---
name: PR Reviewer
description: Reviews pull requests
triggers:
  - source: github
    events:
      - pull_request.opened
      - pull_request.synchronize
---

# Instructions

Review the pull request and provide feedback.

## Guidelines

1. Check for code quality
2. Verify tests are included
`;

      const result = parseSkillMarkdown(content);

      expect(result.name).toBe("PR Reviewer");
      expect(result.description).toBe("Reviews pull requests");
      expect(result.triggers).toHaveLength(1);
      expect(result.triggers[0]?.source).toBe("github");
      expect(result.instructions).toContain("Review the pull request");
    });

    it("should handle markdown without frontmatter", () => {
      const content = `# My Skill

Do something useful.
`;

      const result = parseSkillMarkdown(content);

      expect(result.name).toBeUndefined();
      expect(result.instructions).toContain("My Skill");
    });
  });

  describe("parseSkillConfig", () => {
    it("should parse a skill config.yaml", () => {
      const yaml = `
name: Test Skill
triggers:
  - source: test
    events:
      - test.event
mcpServers:
  filesystem:
    command: npx
    args:
      - "-y"
      - "@modelcontextprotocol/server-filesystem"
    env:
      ALLOWED_DIRS: /tmp
toolPermissions:
  allow:
    - "filesystem:*"
  deny:
    - "filesystem:delete_*"
notifications:
  onComplete: true
  onError: true
`;

      const result = parseSkillConfig(yaml);

      expect(result.name).toBe("Test Skill");
      expect(result.triggers).toHaveLength(1);
      expect(result.mcpServers?.filesystem?.command).toBe("npx");
      expect(result.toolPermissions?.allow).toContain("filesystem:*");
      expect(result.notifications?.onComplete).toBe(true);
    });
  });
});
