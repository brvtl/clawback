import { describe, it, expect, beforeEach } from "vitest";
import { SchedulerService } from "./scheduler.js";
import { createTestConnection } from "@clawback/db";
import { ScheduledJobRepository, SkillRepository, EventRepository } from "@clawback/db";

describe("SchedulerService", () => {
  let schedulerService: SchedulerService;
  let scheduledJobRepo: ScheduledJobRepository;
  let skillRepo: SkillRepository;
  let eventRepo: EventRepository;

  beforeEach(() => {
    const db = createTestConnection();
    scheduledJobRepo = new ScheduledJobRepository(db);
    skillRepo = new SkillRepository(db);
    eventRepo = new EventRepository(db);

    schedulerService = new SchedulerService(
      {
        scheduledJobRepo,
        skillRepo,
        eventRepo,
      },
      { tickIntervalMs: 1000 }
    );
  });

  describe("validateSchedule", () => {
    it("accepts valid cron expressions", () => {
      expect(schedulerService.validateSchedule("0 9 * * *")).toEqual({ valid: true });
      expect(schedulerService.validateSchedule("*/5 * * * *")).toEqual({ valid: true });
      expect(schedulerService.validateSchedule("0 0 1 * *")).toEqual({ valid: true });
    });

    it("rejects invalid cron expressions", () => {
      const result = schedulerService.validateSchedule("invalid");
      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it("rejects expressions that run too frequently", () => {
      const result = schedulerService.validateSchedule("* * * * * *"); // Every second
      expect(result.valid).toBe(false);
      expect(result.error).toContain("too frequently");
    });
  });

  describe("calculateNextRun", () => {
    it("calculates next run from current time", () => {
      const now = new Date("2026-02-05T10:00:00Z");
      const nextRun = schedulerService.calculateNextRun("0 12 * * *", now);

      expect(nextRun).toBeDefined();
      expect(nextRun).toBeGreaterThan(now.getTime());
    });

    it("returns null for invalid cron expressions", () => {
      const result = schedulerService.calculateNextRun("invalid");
      expect(result).toBeNull();
    });
  });

  describe("getNextRuns", () => {
    it("returns upcoming run dates", () => {
      const runs = schedulerService.getNextRuns("0 9 * * *", 5);

      expect(runs).toHaveLength(5);
      runs.forEach((run, i) => {
        expect(run).toBeInstanceOf(Date);
        if (i > 0) {
          expect(run.getTime()).toBeGreaterThan(runs[i - 1]!.getTime());
        }
      });
    });

    it("returns empty array for invalid expressions", () => {
      const runs = schedulerService.getNextRuns("invalid", 5);
      expect(runs).toEqual([]);
    });
  });

  describe("syncJobsFromSkills", () => {
    it("creates jobs for new cron triggers", () => {
      // Create a skill with a cron trigger
      const skill = skillRepo.create({
        name: "Daily Digest",
        instructions: "Send daily digest",
        triggers: [{ source: "cron", schedule: "0 9 * * *" }],
      });

      // Sync jobs
      schedulerService.syncJobsFromSkills();

      // Check that a job was created
      const jobs = scheduledJobRepo.findBySkillId(skill.id);
      expect(jobs).toHaveLength(1);
      expect(jobs[0]!.schedule).toBe("0 9 * * *");
      expect(jobs[0]!.triggerIndex).toBe(0);
    });

    it("handles skills with multiple cron triggers", () => {
      const skill = skillRepo.create({
        name: "Multi-Schedule",
        instructions: "Multiple schedules",
        triggers: [
          { source: "cron", schedule: "0 9 * * *" },
          { source: "cron", schedule: "0 17 * * *" },
          { source: "github", events: ["push"] }, // Non-cron trigger
        ],
      });

      schedulerService.syncJobsFromSkills();

      const jobs = scheduledJobRepo.findBySkillId(skill.id);
      expect(jobs).toHaveLength(2);
    });

    it("removes orphaned jobs when skills are deleted", () => {
      // Create skill and sync
      const skill = skillRepo.create({
        name: "Temp Skill",
        instructions: "Will be deleted",
        triggers: [{ source: "cron", schedule: "0 9 * * *" }],
      });
      schedulerService.syncJobsFromSkills();

      // Verify job exists
      let jobs = scheduledJobRepo.findBySkillId(skill.id);
      expect(jobs).toHaveLength(1);

      // Delete jobs first (due to foreign key constraint), then delete skill
      scheduledJobRepo.deleteBySkillId(skill.id);
      skillRepo.delete(skill.id);
      schedulerService.syncJobsFromSkills();

      // Verify job is removed
      jobs = scheduledJobRepo.findBySkillId(skill.id);
      expect(jobs).toHaveLength(0);
    });
  });

  describe("lifecycle", () => {
    it("starts and stops correctly", () => {
      expect(schedulerService.isRunning()).toBe(false);

      schedulerService.start();
      expect(schedulerService.isRunning()).toBe(true);

      schedulerService.stop();
      expect(schedulerService.isRunning()).toBe(false);
    });

    it("does not start twice", () => {
      schedulerService.start();
      schedulerService.start(); // Should be ignored

      expect(schedulerService.isRunning()).toBe(true);

      schedulerService.stop();
      expect(schedulerService.isRunning()).toBe(false);
    });
  });
});
