import { callApi } from "./types.js";

export const CHECKPOINT_TOOLS = [
  {
    name: "get_checkpoints",
    description:
      "Get execution checkpoints for a skill run or workflow run. Checkpoints are state snapshots at each execution step.",
    inputSchema: {
      type: "object" as const,
      properties: {
        run_id: {
          type: "string",
          description: "The skill run ID or workflow run ID",
        },
        run_type: {
          type: "string",
          enum: ["skill", "workflow"],
          description: "Whether this is a skill run or workflow run (default: skill)",
        },
      },
      required: ["run_id"],
    },
  },
];

export async function handleCheckpointToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "get_checkpoints": {
      const runId = args.run_id as string;
      const runType = (args.run_type as string) || "skill";
      const path =
        runType === "workflow"
          ? `/api/workflow-runs/${runId}/checkpoints`
          : `/api/runs/${runId}/checkpoints`;
      const data = await callApi<{ checkpoints: unknown[] }>(path);
      return data.checkpoints;
    }

    default:
      return null;
  }
}
