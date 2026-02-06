import cronParser from "cron-parser";
import type { ScheduledJobRepository, SkillRepository, EventRepository } from "@clawback/db";
import type { Skill, ScheduledJob } from "@clawback/shared";

export interface SchedulerDependencies {
  scheduledJobRepo: ScheduledJobRepository;
  skillRepo: SkillRepository;
  eventRepo: EventRepository;
}

export interface SchedulerOptions {
  tickIntervalMs?: number; // How often to check for due jobs (default: 60000)
}

export class SchedulerService {
  private scheduledJobRepo: ScheduledJobRepository;
  private skillRepo: SkillRepository;
  private eventRepo: EventRepository;
  private tickIntervalMs: number;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(deps: SchedulerDependencies, options: SchedulerOptions = {}) {
    this.scheduledJobRepo = deps.scheduledJobRepo;
    this.skillRepo = deps.skillRepo;
    this.eventRepo = deps.eventRepo;
    this.tickIntervalMs = options.tickIntervalMs ?? 60000;
  }

  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    console.log("[Scheduler] Starting scheduler service");

    // Run immediately, then on interval
    void this.tick();
    this.intervalId = setInterval(() => {
      void this.tick();
    }, this.tickIntervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.running = false;
    console.log("[Scheduler] Stopped scheduler service");
  }

  isRunning(): boolean {
    return this.running;
  }

  async tick(): Promise<void> {
    const now = Date.now();
    const dueJobs = this.scheduledJobRepo.findDue(now);

    for (const job of dueJobs) {
      try {
        await this.fireJob(job);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error(`[Scheduler] Failed to fire job ${job.id}:`, message);
      }
    }
  }

  private async fireJob(job: ScheduledJob): Promise<void> {
    const skill = this.skillRepo.findById(job.skillId);
    if (!skill) {
      console.warn(`[Scheduler] Skill ${job.skillId} not found for job ${job.id}, disabling job`);
      this.scheduledJobRepo.setEnabled(job.id, false);
      return;
    }

    console.log(`[Scheduler] Firing job ${job.id} for skill "${skill.name}"`);

    // Create cron event
    const timestamp = new Date().toISOString();
    await this.eventRepo.create({
      source: "cron",
      type: "scheduled",
      payload: {
        timestamp,
        schedule: job.schedule,
        skillId: job.skillId,
        jobId: job.id,
      },
      metadata: {
        triggerIndex: job.triggerIndex,
      },
    });

    // Calculate next run time
    const nextRunAt = this.calculateNextRun(job.schedule);
    if (nextRunAt) {
      this.scheduledJobRepo.updateAfterRun(job.id, Date.now(), nextRunAt);
    } else {
      console.warn(`[Scheduler] Could not calculate next run for job ${job.id}, disabling`);
      this.scheduledJobRepo.setEnabled(job.id, false);
    }
  }

  syncJobsFromSkills(): void {
    console.log("[Scheduler] Syncing scheduled jobs from skills");

    const skills = this.skillRepo.findAll(true);
    const existingJobSkillIds = new Set<string>();

    for (const skill of skills) {
      for (let i = 0; i < skill.triggers.length; i++) {
        const trigger = skill.triggers[i];
        if (trigger.source === "cron" && trigger.schedule) {
          existingJobSkillIds.add(skill.id);
          this.syncJob(skill, i, trigger.schedule);
        }
      }
    }

    // Clean up orphaned jobs
    this.cleanupOrphanedJobs(existingJobSkillIds);
  }

  private syncJob(skill: Skill, triggerIndex: number, schedule: string): void {
    const existingJob = this.scheduledJobRepo.findBySkillAndTrigger(skill.id, triggerIndex);

    if (existingJob) {
      // Update if schedule changed
      if (existingJob.schedule !== schedule) {
        const nextRunAt = this.calculateNextRun(schedule);
        if (nextRunAt) {
          this.scheduledJobRepo.update(existingJob.id, {
            schedule,
            nextRunAt,
            enabled: true,
          });
          console.log(
            `[Scheduler] Updated job ${existingJob.id} for skill "${skill.name}" with new schedule`
          );
        }
      }
    } else {
      // Create new job
      const nextRunAt = this.calculateNextRun(schedule);
      if (nextRunAt) {
        const job = this.scheduledJobRepo.create({
          skillId: skill.id,
          triggerIndex,
          schedule,
          nextRunAt,
          enabled: true,
        });
        console.log(`[Scheduler] Created job ${job.id} for skill "${skill.name}"`);
      } else {
        console.warn(
          `[Scheduler] Invalid schedule "${schedule}" for skill "${skill.name}", skipping`
        );
      }
    }
  }

  private cleanupOrphanedJobs(activeSkillIds: Set<string>): void {
    const allJobs = this.scheduledJobRepo.findAll();

    for (const job of allJobs) {
      if (!activeSkillIds.has(job.skillId)) {
        this.scheduledJobRepo.delete(job.id);
        console.log(`[Scheduler] Deleted orphaned job ${job.id}`);
      }
    }
  }

  calculateNextRun(schedule: string, fromDate: Date = new Date()): number | null {
    try {
      const interval = cronParser.parseExpression(schedule, { currentDate: fromDate });
      const next = interval.next();
      return next.getTime();
    } catch {
      return null;
    }
  }

  validateSchedule(schedule: string): { valid: boolean; error?: string } {
    try {
      const interval = cronParser.parseExpression(schedule);

      // Check if schedule runs too frequently (less than 1 minute)
      // Get two consecutive runs to calculate interval
      const firstRun = interval.next();
      const secondRun = interval.next();

      const intervalMs = secondRun.getTime() - firstRun.getTime();
      if (intervalMs < 60000) {
        return {
          valid: false,
          error: "Schedule runs too frequently (minimum interval is 1 minute)",
        };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : "Invalid cron expression",
      };
    }
  }

  getNextRuns(schedule: string, count: number = 5): Date[] {
    try {
      const interval = cronParser.parseExpression(schedule);
      const runs: Date[] = [];
      for (let i = 0; i < count; i++) {
        runs.push(interval.next().toDate());
      }
      return runs;
    } catch {
      return [];
    }
  }
}
