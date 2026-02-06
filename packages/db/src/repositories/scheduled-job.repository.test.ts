import { describe, it, expect, beforeEach } from "vitest";
import { createTestConnection, type DatabaseConnection } from "../connection.js";
import { ScheduledJobRepository } from "./scheduled-job.repository.js";
import { SkillRepository } from "./skill.repository.js";

describe("ScheduledJobRepository", () => {
  let db: DatabaseConnection;
  let repo: ScheduledJobRepository;
  let skillRepo: SkillRepository;
  let testSkillId: string;

  beforeEach(() => {
    db = createTestConnection();
    repo = new ScheduledJobRepository(db);
    skillRepo = new SkillRepository(db);

    // Create a test skill for foreign key reference
    const skill = skillRepo.create({
      name: "Test Skill",
      instructions: "Test instructions",
      triggers: [],
    });
    testSkillId = skill.id;
  });

  describe("create", () => {
    it("creates a scheduled job", () => {
      const job = repo.create({
        skillId: testSkillId,
        triggerIndex: 0,
        schedule: "0 9 * * *",
        nextRunAt: Date.now() + 3600000,
      });

      expect(job.id).toMatch(/^job_/);
      expect(job.skillId).toBe(testSkillId);
      expect(job.schedule).toBe("0 9 * * *");
      expect(job.enabled).toBe(true);
    });

    it("generates unique ID", () => {
      const job1 = repo.create({
        skillId: testSkillId,
        triggerIndex: 0,
        schedule: "0 9 * * *",
        nextRunAt: Date.now() + 3600000,
      });

      const job2 = repo.create({
        skillId: testSkillId,
        triggerIndex: 1,
        schedule: "0 17 * * *",
        nextRunAt: Date.now() + 7200000,
      });

      expect(job1.id).not.toBe(job2.id);
    });
  });

  describe("findDue", () => {
    it("returns jobs where nextRunAt <= now", () => {
      const now = Date.now();

      // Due job
      repo.create({
        skillId: testSkillId,
        triggerIndex: 0,
        schedule: "0 9 * * *",
        nextRunAt: now - 1000, // In the past
      });

      // Not due job
      repo.create({
        skillId: testSkillId,
        triggerIndex: 1,
        schedule: "0 17 * * *",
        nextRunAt: now + 3600000, // In the future
      });

      const dueJobs = repo.findDue(now);
      expect(dueJobs).toHaveLength(1);
      expect(dueJobs[0]!.triggerIndex).toBe(0);
    });

    it("excludes disabled jobs", () => {
      const now = Date.now();

      const job = repo.create({
        skillId: testSkillId,
        triggerIndex: 0,
        schedule: "0 9 * * *",
        nextRunAt: now - 1000,
        enabled: true,
      });

      // Disable the job
      repo.setEnabled(job.id, false);

      const dueJobs = repo.findDue(now);
      expect(dueJobs).toHaveLength(0);
    });

    it("returns empty array when no jobs due", () => {
      const now = Date.now();

      repo.create({
        skillId: testSkillId,
        triggerIndex: 0,
        schedule: "0 9 * * *",
        nextRunAt: now + 3600000, // In the future
      });

      const dueJobs = repo.findDue(now);
      expect(dueJobs).toHaveLength(0);
    });
  });

  describe("updateAfterRun", () => {
    it("updates lastRunAt and nextRunAt", () => {
      const job = repo.create({
        skillId: testSkillId,
        triggerIndex: 0,
        schedule: "0 9 * * *",
        nextRunAt: Date.now(),
      });

      const lastRunAt = Date.now();
      const nextRunAt = Date.now() + 86400000; // Tomorrow

      const updated = repo.updateAfterRun(job.id, lastRunAt, nextRunAt);

      expect(updated?.lastRunAt).toBe(lastRunAt);
      expect(updated?.nextRunAt).toBe(nextRunAt);
    });
  });

  describe("deleteBySkillId", () => {
    it("removes all jobs for a skill", () => {
      repo.create({
        skillId: testSkillId,
        triggerIndex: 0,
        schedule: "0 9 * * *",
        nextRunAt: Date.now() + 3600000,
      });

      repo.create({
        skillId: testSkillId,
        triggerIndex: 1,
        schedule: "0 17 * * *",
        nextRunAt: Date.now() + 7200000,
      });

      const deletedCount = repo.deleteBySkillId(testSkillId);
      expect(deletedCount).toBe(2);

      const remaining = repo.findBySkillId(testSkillId);
      expect(remaining).toHaveLength(0);
    });
  });

  describe("findBySkillAndTrigger", () => {
    it("finds job by skill and trigger index", () => {
      repo.create({
        skillId: testSkillId,
        triggerIndex: 0,
        schedule: "0 9 * * *",
        nextRunAt: Date.now() + 3600000,
      });

      repo.create({
        skillId: testSkillId,
        triggerIndex: 1,
        schedule: "0 17 * * *",
        nextRunAt: Date.now() + 7200000,
      });

      const job = repo.findBySkillAndTrigger(testSkillId, 1);
      expect(job).toBeDefined();
      expect(job?.schedule).toBe("0 17 * * *");
    });

    it("returns undefined if not found", () => {
      const job = repo.findBySkillAndTrigger(testSkillId, 99);
      expect(job).toBeUndefined();
    });
  });
});
