#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const API_URL = process.env.CLAWBACK_API_URL ?? "http://localhost:3000";

// Helper to call Clawback API
async function callApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status} ${response.statusText}`);
  }

  return response.json() as Promise<T>;
}

// Define available tools
const TOOLS = [
  {
    name: "list_skills",
    description: "List all configured skills in Clawback with their triggers and MCP servers",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_skill",
    description: "Get full details of a specific skill including its instructions",
    inputSchema: {
      type: "object" as const,
      properties: {
        skill_id: {
          type: "string",
          description: "The skill ID to get details for",
        },
      },
      required: ["skill_id"],
    },
  },
  {
    name: "list_mcp_servers",
    description: "List all configured MCP servers in Clawback",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "list_events",
    description: "List recent events received by Clawback",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of events to return (default 10)",
        },
      },
      required: [],
    },
  },
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
  {
    name: "get_status",
    description: "Get Clawback system status including uptime and skill count",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "create_skill",
    description: "Create a new skill in Clawback",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Name of the skill",
        },
        description: {
          type: "string",
          description: "Description of what the skill does",
        },
        instructions: {
          type: "string",
          description: "Detailed instructions for Claude when executing this skill",
        },
        triggers: {
          type: "array",
          description: "Array of triggers that activate this skill",
          items: {
            type: "object",
            properties: {
              source: {
                type: "string",
                description: "Event source (github, slack, webhook, schedule)",
              },
              events: {
                type: "array",
                items: { type: "string" },
                description: "Event types to match",
              },
              schedule: { type: "string", description: "Cron expression for scheduled triggers" },
            },
          },
        },
        mcpServers: {
          type: "array",
          description: "Array of MCP server names this skill can use",
          items: { type: "string" },
        },
      },
      required: ["name", "instructions", "triggers"],
    },
  },
  {
    name: "create_mcp_server",
    description: "Create a new MCP server configuration in Clawback",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Unique name for the MCP server",
        },
        description: {
          type: "string",
          description: "Description of what this server provides",
        },
        command: {
          type: "string",
          description: "Command to run (e.g., 'npx')",
        },
        args: {
          type: "array",
          description: "Command arguments",
          items: { type: "string" },
        },
        env: {
          type: "object",
          description: "Environment variables (including credentials)",
          additionalProperties: { type: "string" },
        },
      },
      required: ["name", "command"],
    },
  },
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
              schedule: { type: "string", description: "Cron expression for scheduled triggers" },
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

// Handle tool calls
async function handleToolCall(name: string, args: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case "list_skills": {
      const data = await callApi<{ skills: unknown[] }>("/api/skills");
      return data.skills;
    }

    case "get_skill": {
      const skillId = args.skill_id as string;
      const data = await callApi<{ skill: unknown }>(`/api/skills/${skillId}`);
      return data.skill;
    }

    case "list_mcp_servers": {
      const data = await callApi<{ servers: unknown[] }>("/api/mcp-servers");
      return data.servers;
    }

    case "list_events": {
      const limit = (args.limit as number) || 10;
      const data = await callApi<{ events: unknown[] }>(`/api/events?limit=${limit}`);
      return data.events;
    }

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

    case "get_status": {
      return await callApi<unknown>("/api/status");
    }

    case "create_skill": {
      const data = await callApi<{ skill: unknown }>("/api/skills", {
        method: "POST",
        body: JSON.stringify(args),
      });
      return data.skill;
    }

    case "create_mcp_server": {
      const data = await callApi<{ server: unknown }>("/api/mcp-servers", {
        method: "POST",
        body: JSON.stringify(args),
      });
      return data.server;
    }

    case "list_workflows": {
      const data = await callApi<{ workflows: unknown[] }>("/api/workflows");
      return data.workflows;
    }

    case "get_workflow": {
      const workflowId = args.workflow_id as string;
      const data = await callApi<{ workflow: unknown; skills: unknown[] }>(
        `/api/workflows/${workflowId}`
      );
      return data;
    }

    case "create_workflow": {
      const data = await callApi<{ workflow: unknown }>("/api/workflows", {
        method: "POST",
        body: JSON.stringify(args),
      });
      return data.workflow;
    }

    case "trigger_workflow": {
      const workflowId = args.workflow_id as string;
      const payload = args.payload as Record<string, unknown> | undefined;
      const data = await callApi<{ workflowRun: unknown; event: unknown }>(
        `/api/workflows/${workflowId}/trigger`,
        {
          method: "POST",
          body: JSON.stringify({ payload }),
        }
      );
      return data;
    }

    case "list_workflow_runs": {
      const workflowId = args.workflow_id as string;
      const data = await callApi<{ runs: unknown[] }>(`/api/workflows/${workflowId}/runs`);
      return data.runs;
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Create and run the server
async function main() {
  const server = new Server(
    {
      name: "clawback",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  // Handle list tools request
  server.setRequestHandler(ListToolsRequestSchema, () => {
    return { tools: TOOLS };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      const result = await handleToolCall(name, args ?? {});
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  // Start the server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is used for MCP protocol)
  console.error(`Clawback MCP server started (API: ${API_URL})`);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
