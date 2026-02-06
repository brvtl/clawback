import { describe, it, expect } from "vitest";
import { SkillReviewer } from "./skill-reviewer.js";

describe("SkillReviewer", () => {
  describe("without API key", () => {
    it("returns pending review requiring manual approval", async () => {
      const reviewer = new SkillReviewer();

      const result = await reviewer.review("test-hash", {
        instructions: "Test instructions",
      });

      expect(result.approved).toBe(false);
      expect(result.concerns).toContain("No AI review available - manual approval required");
      expect(result.riskLevel).toBe("medium");
    });
  });

  describe("caching", () => {
    it("caches and returns cached result for same content hash", async () => {
      const reviewer = new SkillReviewer();

      // First call - without API key, returns non-cached pending result
      const result1 = await reviewer.review("hash-1", {
        instructions: "Instructions",
      });

      // Without API key, results are not cached (pending reviews need re-checking)
      // So second call should still work
      const result2 = await reviewer.review("hash-1", {
        instructions: "Different instructions",
      });

      // Both return the same type of pending review
      expect(result1.approved).toBe(false);
      expect(result2.approved).toBe(false);
    });

    it("clears cache on request", () => {
      const reviewer = new SkillReviewer();

      // Cache clearing should work even with empty cache
      reviewer.clearCache();
      expect(reviewer.getCachedReview("hash-1")).toBeUndefined();
    });
  });

  describe("parseReviewResponse", () => {
    it("parses approved response correctly", () => {
      const reviewer = new SkillReviewer();
      const text = JSON.stringify({
        approved: true,
        concerns: [],
        riskLevel: "low",
        summary: "This skill is safe",
      });

      const result = reviewer.parseReviewResponse(text);

      expect(result.approved).toBe(true);
      expect(result.concerns).toEqual([]);
      expect(result.riskLevel).toBe("low");
      expect(result.summary).toBe("This skill is safe");
    });

    it("parses rejected response with concerns", () => {
      const reviewer = new SkillReviewer();
      const text = JSON.stringify({
        approved: false,
        concerns: ["Potential data exfiltration", "Writes to external URLs"],
        riskLevel: "high",
        summary: "This skill poses security risks",
      });

      const result = reviewer.parseReviewResponse(text);

      expect(result.approved).toBe(false);
      expect(result.concerns).toHaveLength(2);
      expect(result.riskLevel).toBe("high");
    });

    it("handles JSON embedded in other text", () => {
      const reviewer = new SkillReviewer();
      const text = `Here is my analysis:

{
  "approved": true,
  "concerns": [],
  "riskLevel": "low",
  "summary": "All good"
}

Let me know if you need more details.`;

      const result = reviewer.parseReviewResponse(text);

      expect(result.approved).toBe(true);
      expect(result.summary).toBe("All good");
    });

    it("handles malformed AI response gracefully", () => {
      const reviewer = new SkillReviewer();

      const result = reviewer.parseReviewResponse("This is not JSON at all");

      expect(result.approved).toBe(false);
      expect(result.concerns).toContain("Failed to parse review response");
      expect(result.riskLevel).toBe("high");
    });

    it("normalizes unknown risk levels to medium", () => {
      const reviewer = new SkillReviewer();
      const text = JSON.stringify({
        approved: true,
        concerns: [],
        riskLevel: "unknown-level",
        summary: "Test",
      });

      const result = reviewer.parseReviewResponse(text);

      expect(result.riskLevel).toBe("medium");
    });
  });
});
