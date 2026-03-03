import { callApi } from "./types.js";

export const MCP_SERVER_TOOLS = [
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
];

export async function handleMcpServerToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
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

    default:
      return null;
  }
}
