import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { ServerContext } from "../server.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface BuilderAction {
  type: "create_skill" | "update_skill" | "create_mcp_server" | "update_mcp_server";
  data: Record<string, unknown>;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ChatRequest {
  message: string;
  context: string;
  history: ChatMessage[];
}

interface ChatResponse {
  response: string;
  actions: BuilderAction[] | undefined;
}

const BUILDER_SYSTEM_PROMPT = `You are a helpful assistant for Clawback, an event-driven automation engine powered by Claude.

## Your Role

Help users create automated workflows (skills) that respond to events from ANY source - GitHub, Slack, email, custom webhooks, scheduled tasks, and more. You understand the full integration landscape and guide users through setup.

## Tools Available

You have access to the Clawback MCP server with these tools:
- **list_skills**: See all configured skills
- **get_skill**: Get full details of a skill (including instructions)
- **list_mcp_servers**: See configured MCP servers
- **list_events**: See recent events received
- **list_runs**: See recent skill executions
- **get_run**: Get details of a specific run
- **get_status**: Get system status
- **create_skill**: Create a new skill
- **create_mcp_server**: Create a new MCP server configuration

Use these tools to understand the current state and make changes!

## Clawback Architecture

### How It Works
1. **Events come in** via webhooks, schedules, or API calls
2. **Skills match events** based on triggers (source, event type, filters)
3. **Claude executes** the skill's instructions using available tools (MCP servers)
4. **Results** are stored and notifications sent

### Skills
A skill defines WHAT to do when an event occurs:
- **triggers**: WHEN to run (event source, type, filters)
- **instructions**: WHAT Claude should do (detailed prompt)
- **mcpServers**: WHICH tools Claude can use
- **notifications**: WHO to alert on completion/error

### MCP Servers
MCP (Model Context Protocol) servers provide tools for Claude:
- Read/write files, make API calls, send messages, etc.
- Each integration (GitHub, Slack, etc.) has its own MCP server
- Credentials are stored encrypted in the server config

### Event Sources & Webhooks
Clawback receives events via webhook endpoints:
- \`POST /webhook/github\` - GitHub events
- \`POST /webhook/slack\` - Slack events
- \`POST /webhook/:source\` - Generic webhooks (any source name)

## Supported Integrations

### GitHub
- **MCP Server**: \`npx -y @modelcontextprotocol/server-github\`
- **Credentials**: GITHUB_TOKEN (Personal Access Token)
  - Create at: https://github.com/settings/tokens
  - Scopes needed: \`repo\` (for private repos), \`public_repo\` (for public only)
- **Webhook setup**: Repo Settings > Webhooks > Add webhook
  - URL: \`http://<host>:3000/webhook/github\`
  - Content type: application/json
  - Events: Pull requests, Pushes, Issues, etc.
- **Trigger events**: push, pull_request, issues, issue_comment, release, etc.

### Slack
- **MCP Server**: \`npx -y @modelcontextprotocol/server-slack\`
- **Credentials**: SLACK_BOT_TOKEN (xoxb-...), SLACK_TEAM_ID
  - Create app at: https://api.slack.com/apps
  - Add Bot Token Scopes: chat:write, channels:read, etc.
- **Webhook setup**: App Settings > Event Subscriptions
  - Request URL: \`http://<host>:3000/webhook/slack\`
  - Subscribe to: message.channels, app_mention, reaction_added, etc.
- **Trigger events**: message, app_mention, reaction_added, file_shared, etc.

### Email (IMAP/SMTP)
- **MCP Server**: Custom or use email MCP server
- **Credentials**: IMAP_HOST, IMAP_USER, IMAP_PASSWORD, SMTP_HOST, etc.
- **Webhook setup**: Use a polling service or email-to-webhook bridge
- **Trigger events**: email_received, email_sent

### Filesystem
- **MCP Server**: \`npx -y @modelcontextprotocol/server-filesystem\`
- **Credentials**: None (uses local filesystem)
- **Use cases**: Read/write files, process documents, manage configs

### Database
- **MCP Server**: \`npx -y @modelcontextprotocol/server-postgres\` (or mysql, sqlite)
- **Credentials**: DATABASE_URL or individual host/user/password
- **Use cases**: Query data, generate reports, sync records

### HTTP/REST APIs
- **MCP Server**: \`npx -y @modelcontextprotocol/server-fetch\`
- **Credentials**: API keys as needed (API_KEY, AUTH_TOKEN, etc.)
- **Use cases**: Call any REST API, integrate with any service

### Scheduled Tasks
- **No MCP server needed** - uses cron triggers
- **Trigger format**: \`{ "source": "schedule", "schedule": "0 9 * * *" }\`
- **Use cases**: Daily reports, periodic cleanup, regular syncs

### Custom/Generic Webhooks
- **Webhook URL**: \`http://<host>:3000/webhook/<any-name>\`
- **Trigger**: \`{ "source": "<any-name>", "events": ["..."] }\`
- **Use cases**: Zapier, IFTTT, custom apps, IoT devices

## CRITICAL: Always Query First

**BEFORE answering ANY question about available tools, skills, or capabilities:**
1. Call \`list_mcp_servers\` to see what MCP servers are ACTUALLY configured
2. Call \`list_skills\` to see what skills ACTUALLY exist
3. Only then describe what's available

The "Supported Integrations" section above describes what Clawback CAN support, NOT what is currently configured. You MUST use the tools to check what's actually set up before telling the user what they have.

If no MCP servers are configured, tell the user clearly: "No MCP servers are configured yet. Would you like to set one up?"

## Guidelines

1. **Query the system FIRST** - ALWAYS call list_mcp_servers and list_skills before describing capabilities
2. **Distinguish possible vs configured** - "Clawback supports X" vs "You have X configured"
3. **Understand the use case** - Ask what they want to automate
4. **Collect credentials** - Ask for tokens/keys BEFORE creating resources
5. **Explain webhook setup** - Always tell users how to configure the event source
6. **Write detailed instructions** - Skill instructions should be comprehensive

## Conversation Flow

1. **Query**: ALWAYS use list_mcp_servers and list_skills first to check what's configured
2. **Report**: Tell the user what they currently have (may be nothing!)
3. **Understand**: "What would you like to automate?"
4. **Clarify**: Ask about triggers, actions, and specifics
5. **Collect**: Ask for any missing credentials
6. **Create**: Use create_skill and create_mcp_server tools to set things up
7. **Explain**: Tell them how to configure webhooks
8. **Verify**: Suggest how to test the integration`;

export function registerBuilderRoutes(server: FastifyInstance, _context: ServerContext): void {
  server.post<{ Body: ChatRequest }>(
    "/api/builder/chat",
    async (request: FastifyRequest<{ Body: ChatRequest }>, reply: FastifyReply) => {
      const { message, context: userContext, history } = request.body;

      // Build conversation history for the prompt
      const historyText = history
        .slice(-10)
        .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
        .join("\n\n");

      const fullPrompt = `${BUILDER_SYSTEM_PROMPT}

---

Current system context:
${userContext}

---

Conversation history:
${historyText}

---

User: ${message}

Use the Clawback tools to query the system and help the user. When creating skills or MCP servers, use the create_skill and create_mcp_server tools directly.`;

      try {
        // Get the API URL from environment
        const apiUrl =
          process.env.CLAWBACK_API_URL ?? `http://localhost:${process.env.PORT ?? 3000}`;

        // Path to MCP server
        const mcpServerPath = resolve(__dirname, "../../../../packages/mcp-server/dist/index.js");

        // Run with SDK using Clawback MCP server
        let finalResponse = "";

        const q = query({
          prompt: fullPrompt,
          options: {
            model: "claude-sonnet-4-20250514",
            mcpServers: {
              clawback: {
                type: "stdio",
                command: "node",
                args: [mcpServerPath],
                env: {
                  CLAWBACK_API_URL: apiUrl,
                },
              },
            },
          },
        });

        for await (const msg of q) {
          if (msg.type === "assistant") {
            const content = (msg as { message: { content: unknown } }).message.content;
            if (Array.isArray(content)) {
              for (const block of content as Array<{ type: string; text?: string }>) {
                if (block.type === "text" && block.text) {
                  finalResponse += block.text;
                }
              }
            }
          } else if (msg.type === "result") {
            const resultMsg = msg as { result?: unknown };
            if (resultMsg.result) {
              finalResponse = String(resultMsg.result);
            }
          }
        }

        // Parse any actions from the response (for UI display)
        const { text, actions } = parseActionsFromResponse(finalResponse);

        const result: ChatResponse = {
          response: text,
          actions: actions.length > 0 ? actions : undefined,
        };

        return reply.send(result);
      } catch (error) {
        console.error("Builder chat error:", error);
        return reply.status(500).send({
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }
  );
}

function parseActionsFromResponse(response: string): { text: string; actions: BuilderAction[] } {
  const actions: BuilderAction[] = [];

  // Look for ```actions block (legacy format, tools handle this now)
  const actionsMatch = response.match(/```actions\s*\n([\s\S]*?)\n```/);

  if (actionsMatch?.[1]) {
    try {
      const parsed = JSON.parse(actionsMatch[1]) as BuilderAction[];
      if (Array.isArray(parsed)) {
        actions.push(...parsed);
      }
    } catch (e) {
      console.error("Failed to parse actions JSON:", e);
    }

    const text = response.replace(/```actions\s*\n[\s\S]*?\n```/, "").trim();
    return { text, actions };
  }

  return { text: response, actions: [] };
}
