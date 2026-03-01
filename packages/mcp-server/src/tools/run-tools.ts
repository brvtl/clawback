import { callApi } from "./types.js";

export const RUN_TOOLS = [
  {
    name: "list_runs",
    description: "List recent skill execution runs in Clawback",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of runs to return (default 10)",
        },
        skill_id: {
          type: "string",
          description: "Filter runs by skill ID (optional)",
        },
      },
      required: [],
    },
  },
  {
    name: "get_run",
    description: "Get details of a specific skill execution run including tool calls and output",
    inputSchema: {
      type: "object" as const,
      properties: {
        run_id: {
          type: "string",
          description: "The run ID to get details for",
        },
      },
      required: ["run_id"],
    },
  },
];

export async function handleRunToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "list_runs": {
      const limit = (args.limit as number) || 10;
      const skillId = args.skill_id as string | undefined;
      const params = new URLSearchParams({ limit: String(limit) });
      if (skillId) params.set("skillId", skillId);
      const data = await callApi<{ runs: unknown[] }>(`/api/runs?${params.toString()}`);
      return data.runs;
    }

    case "get_run": {
      const runId = args.run_id as string;
      const data = await callApi<{ run: unknown }>(`/api/runs/${runId}`);
      return data.run;
    }

    default:
      return null;
  }
}
