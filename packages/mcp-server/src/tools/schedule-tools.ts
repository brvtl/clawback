import { callApi } from "./types.js";

export const SCHEDULE_TOOLS = [
  {
    name: "list_scheduled_jobs",
    description: "List all scheduled cron jobs for skills and workflows",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "toggle_scheduled_job",
    description: "Enable or disable a scheduled job without deleting it",
    inputSchema: {
      type: "object" as const,
      properties: {
        job_id: {
          type: "string",
          description: "The scheduled job ID",
        },
        enabled: {
          type: "boolean",
          description: "Whether the job should be enabled",
        },
      },
      required: ["job_id", "enabled"],
    },
  },
];

export async function handleScheduleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "list_scheduled_jobs": {
      const data = await callApi<{ jobs: unknown[] }>("/api/scheduled-jobs");
      return data.jobs;
    }

    case "toggle_scheduled_job": {
      const jobId = args.job_id as string;
      const enabled = args.enabled as boolean;
      const data = await callApi<{ job: unknown }>(`/api/scheduled-jobs/${jobId}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      return data.job;
    }

    default:
      return null;
  }
}
