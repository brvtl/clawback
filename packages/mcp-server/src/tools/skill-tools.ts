import { callApi } from "./types.js";

export const SKILL_TOOLS = [
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
];

export async function handleSkillToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
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

    default:
      return null;
  }
}
