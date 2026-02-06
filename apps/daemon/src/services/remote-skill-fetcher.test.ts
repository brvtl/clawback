import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RemoteSkillFetcher } from "./remote-skill-fetcher.js";

describe("RemoteSkillFetcher", () => {
  let fetcher: RemoteSkillFetcher;

  beforeEach(() => {
    fetcher = new RemoteSkillFetcher();
  });

  describe("validateUrl", () => {
    it("accepts valid HTTPS URLs", () => {
      expect(fetcher.validateUrl("https://example.com/skill.md")).toEqual({ valid: true });
      expect(fetcher.validateUrl("https://moltbook.com/skills/daily-digest.md")).toEqual({
        valid: true,
      });
    });

    it("rejects HTTP URLs", () => {
      const result = fetcher.validateUrl("http://example.com/skill.md");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("HTTPS");
    });

    it("rejects localhost URLs", () => {
      const result = fetcher.validateUrl("https://localhost/skill.md");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Local");
    });

    it("rejects private network URLs", () => {
      expect(fetcher.validateUrl("https://192.168.1.1/skill.md").valid).toBe(false);
      expect(fetcher.validateUrl("https://10.0.0.1/skill.md").valid).toBe(false);
      expect(fetcher.validateUrl("https://172.16.0.1/skill.md").valid).toBe(false);
    });

    it("rejects .local domain URLs", () => {
      const result = fetcher.validateUrl("https://myserver.local/skill.md");
      expect(result.valid).toBe(false);
    });

    it("rejects invalid URL format", () => {
      const result = fetcher.validateUrl("not-a-url");
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid URL");
    });
  });

  describe("content hash", () => {
    it("produces same hash for same content", async () => {
      // Mock fetch for testing
      const mockContent = `---
name: Test Skill
---

Instructions here`;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockContent),
      });

      const result1 = await fetcher.fetch("https://example.com/skill.md");
      const result2 = await fetcher.fetch("https://example.com/skill.md");

      expect(result1.contentHash).toBe(result2.contentHash);
    });

    it("produces different hash when content changes", async () => {
      global.fetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          text: () =>
            Promise.resolve(`---
name: Skill V1
---

Original instructions`),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: () =>
            Promise.resolve(`---
name: Skill V2
---

Updated instructions`),
        });

      const result1 = await fetcher.fetch("https://example.com/skill.md");
      const result2 = await fetcher.fetch("https://example.com/skill.md");

      expect(result1.contentHash).not.toBe(result2.contentHash);
    });
  });

  describe("fetch", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("fetches and parses skill markdown", async () => {
      const mockContent = `---
name: Test Skill
description: A test skill
triggers:
  - source: github
    events: [push]
---

Process the event and respond.`;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(mockContent),
      });

      const result = await fetcher.fetch("https://example.com/skill.md");

      expect(result.skillMarkdown.name).toBe("Test Skill");
      expect(result.skillMarkdown.description).toBe("A test skill");
      expect(result.skillMarkdown.triggers).toHaveLength(1);
      expect(result.skillMarkdown.instructions).toContain("Process the event");
      expect(result.contentHash).toBeDefined();
      expect(result.contentHash.length).toBe(64); // SHA-256 hex
    });

    it("handles non-200 responses", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      await expect(fetcher.fetch("https://example.com/missing.md")).rejects.toThrow("HTTP 404");
    });

    it("handles network errors", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      await expect(fetcher.fetch("https://example.com/skill.md")).rejects.toThrow("Network error");
    });
  });
});
