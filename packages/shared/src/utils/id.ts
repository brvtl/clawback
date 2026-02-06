import { randomBytes } from "crypto";

export function generateId(prefix: string): string {
  const random = randomBytes(8).toString("hex");
  return `${prefix}_${random}`;
}

export function generateEventId(): string {
  return generateId("evt");
}

export function generateRunId(): string {
  return generateId("run");
}

export function generateNotificationId(): string {
  return generateId("notif");
}

export function generateToolCallId(): string {
  return generateId("tc");
}

export function generateSkillId(): string {
  return generateId("skill");
}

export function generateScheduledJobId(): string {
  return generateId("job");
}

export function generateWorkflowId(): string {
  return generateId("wf");
}

export function generateWorkflowRunId(): string {
  return generateId("wfrun");
}
