import { callApi } from "./types.js";

export const WORKFLOW_TOOLS = [
  {
    name: "list_workflows",
    description:
      "List all configured workflows in Clawback. Workflows orchestrate multiple skills with AI coordination.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_workflow",
    description:
      "Get full details of a specific workflow including its instructions and associated skills",
    inputSchema: {
      type: "object" as const,
      properties: {
        workflow_id: {
          type: "string",
          description: "The workflow ID to get details for",
        },
      },
      required: ["workflow_id"],
    },
  },
  {
    name: "create_workflow",
    description:
      "Create a new workflow in Clawback. Workflows use AI (Opus or Sonnet) to orchestrate multiple skills.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Name of the workflow",
        },
        description: {
          type: "string",
          description: "Description of what the workflow does",
        },
        instructions: {
          type: "string",
          description:
            "Detailed instructions for the AI orchestrator on how to coordinate the skills",
        },
        triggers: {
          type: "array",
          description: "Array of triggers that activate this workflow",
          items: {
            type: "object",
            properties: {
              source: {
                type: "string",
                description: "Event source (github, slack, webhook, cron, api)",
              },
              events: {
                type: "array",
                items: { type: "string" },
                description: "Event types to match",
              },
              schedule: {
                type: "string",
                description: "Cron expression for scheduled triggers",
              },
            },
          },
        },
        skills: {
          type: "array",
          description: "Array of skill IDs that this workflow can orchestrate",
          items: { type: "string" },
        },
        orchestratorModel: {
          type: "string",
          description: "AI model for orchestration: 'opus' (most capable) or 'sonnet' (faster)",
          enum: ["opus", "sonnet"],
        },
      },
      required: ["name", "instructions", "triggers", "skills"],
    },
  },
  {
    name: "update_workflow",
    description:
      "Update an existing workflow's name, instructions, triggers, skills, or other settings",
    inputSchema: {
      type: "object" as const,
      properties: {
        workflow_id: {
          type: "string",
          description: "The workflow ID to update",
        },
        name: { type: "string", description: "New name" },
        description: { type: "string", description: "New description" },
        instructions: { type: "string", description: "New instructions" },
        triggers: {
          type: "array",
          description: "New triggers array",
          items: {
            type: "object",
            properties: {
              source: { type: "string" },
              events: { type: "array", items: { type: "string" } },
              schedule: { type: "string" },
            },
          },
        },
        skills: {
          type: "array",
          description: "Array of skill IDs",
          items: { type: "string" },
        },
        orchestratorModel: {
          type: "string",
          enum: ["opus", "sonnet"],
          description: "AI model for orchestration",
        },
        enabled: {
          type: "boolean",
          description: "Enable or disable the workflow",
        },
      },
      required: ["workflow_id"],
    },
  },
  {
    name: "delete_workflow",
    description: "Delete a workflow from Clawback",
    inputSchema: {
      type: "object" as const,
      properties: {
        workflow_id: {
          type: "string",
          description: "The workflow ID to delete",
        },
      },
      required: ["workflow_id"],
    },
  },
  {
    name: "trigger_workflow",
    description: "Manually trigger a workflow to run immediately",
    inputSchema: {
      type: "object" as const,
      properties: {
        workflow_id: {
          type: "string",
          description: "The workflow ID to trigger",
        },
        payload: {
          type: "object",
          description: "Optional payload data to pass to the workflow",
        },
      },
      required: ["workflow_id"],
    },
  },
  {
    name: "list_workflow_runs",
    description: "List recent runs of a specific workflow",
    inputSchema: {
      type: "object" as const,
      properties: {
        workflow_id: {
          type: "string",
          description: "The workflow ID to list runs for",
        },
      },
      required: ["workflow_id"],
    },
  },
];

export async function handleWorkflowToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "list_workflows": {
      const data = await callApi<{ workflows: unknown[] }>("/api/workflows");
      return data.workflows;
    }

    case "get_workflow": {
      const workflowId = args.workflow_id as string;
      const data = await callApi<{
        workflow: unknown;
        skills: unknown[];
      }>(`/api/workflows/${workflowId}`);
      return data;
    }

    case "create_workflow": {
      const data = await callApi<{ workflow: unknown }>("/api/workflows", {
        method: "POST",
        body: JSON.stringify(args),
      });
      return data.workflow;
    }

    case "update_workflow": {
      const workflowId = args.workflow_id as string;
      const body = { ...args };
      delete body.workflow_id;
      const data = await callApi<{ workflow: unknown }>(`/api/workflows/${workflowId}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      return data.workflow;
    }

    case "delete_workflow": {
      const workflowId = args.workflow_id as string;
      return await callApi<{ success: boolean }>(`/api/workflows/${workflowId}`, {
        method: "DELETE",
      });
    }

    case "trigger_workflow": {
      const workflowId = args.workflow_id as string;
      const payload = args.payload as Record<string, unknown> | undefined;
      const data = await callApi<{
        message: string;
        workflowId: string;
        event: unknown;
      }>(`/api/workflows/${workflowId}/trigger`, {
        method: "POST",
        body: JSON.stringify({ payload }),
      });
      return data;
    }

    case "list_workflow_runs": {
      const workflowId = args.workflow_id as string;
      const data = await callApi<{ runs: unknown[] }>(`/api/workflows/${workflowId}/runs`);
      return data.runs;
    }

    default:
      return null;
  }
}
