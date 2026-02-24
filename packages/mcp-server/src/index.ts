#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, handleToolCall } from "./tools.js";

export { TOOLS, handleToolCall } from "./tools.js";

const VERSION = "0.1.0";

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

  const API_URL = process.env.CLAWBACK_API_URL ?? "http://localhost:3000";
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
