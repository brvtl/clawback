#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const VERSION = "0.1.0";
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
export const TOOLS = [
  // ── Skills ──────────────────────────────────────────────
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
              schedule: {
                type: "string",
                description: "Cron expression for scheduled triggers",
              },
            },
          },
        },
        mcpServers: {
          type: "array",
          description: "Array of MCP server names this skill can use",
          items: { type: "string" },
        },
        model: {
          type: "string",
          description:
            "AI model for skill execution: 'haiku' (fast, cheap), 'sonnet' (balanced, default), or 'opus' (most capable)",
          enum: ["haiku", "sonnet", "opus"],
        },
      },
      required: ["name", "instructions", "triggers"],
    },
  },
  {
    name: "update_skill",
    description: "Update an existing skill's name, instructions, triggers, or other settings",
    inputSchema: {
      type: "object" as const,
      properties: {
        skill_id: {
          type: "string",
          description: "The skill ID to update",
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
        mcpServers: {
          type: "object",
          description: "MCP server configurations",
        },
        toolPermissions: {
          type: "object",
          description: "Tool permission rules",
          properties: {
            allow: { type: "array", items: { type: "string" } },
            deny: { type: "array", items: { type: "string" } },
          },
        },
        model: {
          type: "string",
          enum: ["haiku", "sonnet", "opus"],
          description: "AI model for execution",
        },
      },
      required: ["skill_id"],
    },
  },
  {
    name: "delete_skill",
    description: "Delete a skill from Clawback",
    inputSchema: {
      type: "object" as const,
      properties: {
        skill_id: {
          type: "string",
          description: "The skill ID to delete",
        },
      },
      required: ["skill_id"],
    },
  },
  {
    name: "import_remote_skill",
    description:
      "Import a skill from a remote URL (e.g., GitHub raw file). The skill will be AI-reviewed for security risks.",
    inputSchema: {
      type: "object" as const,
      properties: {
        source_url: {
          type: "string",
          description: "URL to fetch the skill definition from",
        },
        name: {
          type: "string",
          description: "Optional name override for the imported skill",
        },
      },
      required: ["source_url"],
    },
  },

  // ── Workflows ───────────────────────────────────────────
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

  // ── Events ──────────────────────────────────────────────
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

  // ── Runs ────────────────────────────────────────────────
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

  // ── Checkpoints ─────────────────────────────────────────
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

  // ── HITL (Human-in-the-Loop) ────────────────────────────
  {
    name: "list_hitl_requests",
    description:
      "List pending human-in-the-loop requests. These are paused workflows waiting for human input.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_hitl_request",
    description:
      "Get details of a specific HITL request including the prompt, context, and options",
    inputSchema: {
      type: "object" as const,
      properties: {
        request_id: {
          type: "string",
          description: "The HITL request ID",
        },
      },
      required: ["request_id"],
    },
  },
  {
    name: "respond_to_hitl",
    description: "Submit a human response to a HITL request, resuming the paused workflow",
    inputSchema: {
      type: "object" as const,
      properties: {
        request_id: {
          type: "string",
          description: "The HITL request ID to respond to",
        },
        response: {
          type: "string",
          description: "The human response text",
        },
      },
      required: ["request_id", "response"],
    },
  },
  {
    name: "cancel_hitl_request",
    description: "Cancel a pending HITL request, which will fail the associated workflow",
    inputSchema: {
      type: "object" as const,
      properties: {
        request_id: {
          type: "string",
          description: "The HITL request ID to cancel",
        },
      },
      required: ["request_id"],
    },
  },

  // ── Scheduled Jobs ──────────────────────────────────────
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

  // ── MCP Servers ─────────────────────────────────────────
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
    name: "update_mcp_server",
    description: "Update an existing MCP server configuration",
    inputSchema: {
      type: "object" as const,
      properties: {
        server_id: {
          type: "string",
          description: "The MCP server ID to update",
        },
        name: { type: "string", description: "New name" },
        description: { type: "string", description: "New description" },
        command: { type: "string", description: "New command" },
        args: {
          type: "array",
          description: "New command arguments",
          items: { type: "string" },
        },
        env: {
          type: "object",
          description: "New environment variables",
          additionalProperties: { type: "string" },
        },
        enabled: {
          type: "boolean",
          description: "Enable or disable the server",
        },
      },
      required: ["server_id"],
    },
  },
  {
    name: "delete_mcp_server",
    description: "Delete an MCP server configuration from Clawback",
    inputSchema: {
      type: "object" as const,
      properties: {
        server_id: {
          type: "string",
          description: "The MCP server ID to delete",
        },
      },
      required: ["server_id"],
    },
  },

  // ── System ──────────────────────────────────────────────
  {
    name: "get_status",
    description: "Get Clawback system status including uptime and skill count",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

// Handle tool calls
export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    // ── Skills ──────────────────────────────────────────
    case "list_skills": {
      const data = await callApi<{ skills: unknown[] }>("/api/skills");
      return data.skills;
    }

    case "get_skill": {
      const skillId = args.skill_id as string;
      const data = await callApi<{ skill: unknown }>(`/api/skills/${skillId}`);
      return data.skill;
    }

    case "create_skill": {
      const data = await callApi<{ skill: unknown }>("/api/skills", {
        method: "POST",
        body: JSON.stringify(args),
      });
      return data.skill;
    }

    case "update_skill": {
      const skillId = args.skill_id as string;
      const body = { ...args };
      delete body.skill_id;
      const data = await callApi<{ skill: unknown }>(`/api/skills/${skillId}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      return data.skill;
    }

    case "delete_skill": {
      const skillId = args.skill_id as string;
      return await callApi<{ success: boolean }>(`/api/skills/${skillId}`, { method: "DELETE" });
    }

    case "import_remote_skill": {
      const data = await callApi<{
        skill: unknown;
        reviewResult: unknown;
        warnings?: unknown;
      }>("/api/skills/remote", {
        method: "POST",
        body: JSON.stringify({
          sourceUrl: args.source_url,
          name: args.name,
        }),
      });
      return data;
    }

    // ── Workflows ─────────────────────────────────────
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
        workflowRun: unknown;
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

    // ── Events ────────────────────────────────────────
    case "list_events": {
      const limit = (args.limit as number) || 10;
      const data = await callApi<{ events: unknown[] }>(`/api/events?limit=${limit}`);
      return data.events;
    }

    // ── Runs ──────────────────────────────────────────
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

    // ── Checkpoints ───────────────────────────────────
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

    // ── HITL ──────────────────────────────────────────
    case "list_hitl_requests": {
      const data = await callApi<{ requests: unknown[] }>("/api/hitl-requests");
      return data.requests;
    }

    case "get_hitl_request": {
      const requestId = args.request_id as string;
      const data = await callApi<{ request: unknown }>(`/api/hitl-requests/${requestId}`);
      return data.request;
    }

    case "respond_to_hitl": {
      const requestId = args.request_id as string;
      const response = args.response as string;
      const data = await callApi<{ request: unknown; message: string }>(
        `/api/hitl-requests/${requestId}/respond`,
        {
          method: "POST",
          body: JSON.stringify({ response }),
        }
      );
      return data;
    }

    case "cancel_hitl_request": {
      const requestId = args.request_id as string;
      const data = await callApi<{ request: unknown; message: string }>(
        `/api/hitl-requests/${requestId}/cancel`,
        { method: "POST" }
      );
      return data;
    }

    // ── Scheduled Jobs ────────────────────────────────
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

    // ── MCP Servers ───────────────────────────────────
    case "list_mcp_servers": {
      const data = await callApi<{ servers: unknown[] }>("/api/mcp-servers");
      return data.servers;
    }

    case "create_mcp_server": {
      const data = await callApi<{ server: unknown }>("/api/mcp-servers", {
        method: "POST",
        body: JSON.stringify(args),
      });
      return data.server;
    }

    case "update_mcp_server": {
      const serverId = args.server_id as string;
      const body = { ...args };
      delete body.server_id;
      const data = await callApi<{ server: unknown }>(`/api/mcp-servers/${serverId}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      return data.server;
    }

    case "delete_mcp_server": {
      const serverId = args.server_id as string;
      return await callApi<{ success: boolean }>(`/api/mcp-servers/${serverId}`, {
        method: "DELETE",
      });
    }

    // ── System ────────────────────────────────────────
    case "get_status": {
      return await callApi<unknown>("/api/status");
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// Start the MCP server
async function startServer(): Promise<void> {
  const server = new Server(
    {
      name: "clawback",
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, () => {
    return { tools: TOOLS };
  });

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

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Log to stderr (stdout is reserved for MCP protocol)
  console.error(`Clawback MCP server started (API: ${API_URL})`);
}

// CLI routing
const arg = process.argv[2];

if (arg === "setup") {
  import("./setup.js")
    .then((m) => m.runSetup())
    .catch((error) => {
      console.error("Setup failed:", error);
      process.exit(1);
    });
} else if (arg === "--help" || arg === "-h") {
  console.error(`clawback-mcp v${VERSION}

Usage:
  clawback-mcp           Start the MCP server (stdio transport)
  clawback-mcp setup     Configure Claude Desktop or Claude Code
  clawback-mcp --help    Show this help message
  clawback-mcp --version Show version

Environment:
  CLAWBACK_API_URL  Clawback daemon URL (default: http://localhost:3000)`);
} else if (arg === "--version" || arg === "-v") {
  console.error(VERSION);
} else {
  startServer().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
}
