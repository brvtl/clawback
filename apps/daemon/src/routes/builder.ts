import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import Anthropic from "@anthropic-ai/sdk";
import type { ServerContext } from "../server.js";

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

// Tools the builder can use to query Clawback
const BUILDER_TOOLS: Anthropic.Tool[] = [
  {
    name: "list_skills",
    description: "List all configured skills with their triggers and MCP servers",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_skill",
    description: "Get full details of a specific skill including instructions",
    input_schema: {
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
    description: "List all configured MCP servers with their commands and status",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "list_events",
    description: "List recent events received by Clawback",
    input_schema: {
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
    description: "List recent skill execution runs",
    input_schema: {
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
    description: "Get details of a specific run including tool calls and output",
    input_schema: {
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

const BUILDER_SYSTEM_PROMPT = `You are a helpful assistant for Clawback, an event-driven automation engine powered by Claude.

## Your Role

Help users create automated workflows (skills) that respond to events from ANY source - GitHub, Slack, email, custom webhooks, scheduled tasks, and more. You understand the full integration landscape and guide users through setup.

## Tools Available

You have tools to query the Clawback system:
- **list_skills**: See all configured skills
- **get_skill**: Get full details of a skill (including instructions)
- **list_mcp_servers**: See configured MCP servers
- **list_events**: See recent events received
- **list_runs**: See recent skill executions
- **get_run**: Get details of a specific run

Use these tools to understand the current state before making changes!

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

## Response Format

When creating/updating resources, include actions at the END of your response:

\`\`\`actions
[
  { "type": "create_mcp_server", "data": { "name": "...", "command": "...", "args": [...], "env": {...} } },
  { "type": "create_skill", "data": { "name": "...", "instructions": "...", "triggers": [...], "mcpServers": [...] } }
]
\`\`\`

## Guidelines

1. **Use tools to understand current state** - Always check what exists before suggesting changes
2. **Understand the use case first** - Ask what they want to automate
3. **Check existing MCP servers** - Use list_mcp_servers before creating new ones
4. **Collect credentials** - Ask for tokens/keys BEFORE creating resources
5. **Explain webhook setup** - Always tell users how to configure the event source
6. **Write detailed instructions** - Skill instructions should be comprehensive
7. **Consider the full flow** - Event → Trigger → Tools → Actions → Notifications

## Conversation Flow

1. **Query**: Use tools to check what's already configured
2. **Understand**: "What would you like to automate?"
3. **Clarify**: Ask about triggers, actions, and specifics
4. **Collect**: Ask for any missing credentials
5. **Create**: Set up MCP server(s) and skill together
6. **Explain**: Tell them how to configure webhooks
7. **Verify**: Suggest how to test the integration`;

export function registerBuilderRoutes(server: FastifyInstance, context: ServerContext): void {
  server.post<{ Body: ChatRequest }>(
    "/api/builder/chat",
    async (request: FastifyRequest<{ Body: ChatRequest }>, reply: FastifyReply) => {
      const { message, context: userContext, history } = request.body;

      const apiKey = process.env.ANTHROPIC_API_KEY;
      if (!apiKey) {
        return reply.status(500).send({
          error: "ANTHROPIC_API_KEY required for builder (tool use not supported in SDK mode)",
        });
      }

      const anthropic = new Anthropic({ apiKey });

      // Build messages from history
      const messages: Anthropic.MessageParam[] = [];
      for (const msg of history.slice(-10)) {
        messages.push({
          role: msg.role,
          content: msg.content,
        });
      }

      // Add current message with context
      messages.push({
        role: "user",
        content: `Current system state:\n${userContext}\n\n---\n\nUser: ${message}`,
      });

      try {
        // Run agentic loop with tools
        let continueLoop = true;
        let finalResponse = "";

        while (continueLoop) {
          const response = await anthropic.messages.create({
            model: "claude-sonnet-4-20250514",
            max_tokens: 4096,
            system: BUILDER_SYSTEM_PROMPT,
            tools: BUILDER_TOOLS,
            messages,
          });

          // Check for tool use
          const toolUseBlocks = response.content.filter(
            (block) => block.type === "tool_use"
          ) as Array<{ type: "tool_use"; id: string; name: string; input: unknown }>;

          if (toolUseBlocks.length > 0) {
            // Process tool calls
            const toolResults: Anthropic.ToolResultBlockParam[] = [];

            for (const toolUse of toolUseBlocks) {
              const result = await handleToolCall(
                toolUse.name,
                toolUse.input as Record<string, unknown>,
                context
              );
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: JSON.stringify(result, null, 2),
              });
            }

            // Add assistant message and tool results
            messages.push({ role: "assistant", content: response.content });
            messages.push({ role: "user", content: toolResults });
          } else {
            // No tool use, extract final response
            const textBlocks = response.content.filter(
              (block): block is Anthropic.TextBlock => block.type === "text"
            );
            finalResponse = textBlocks.map((b) => b.text).join("\n");
            continueLoop = false;
          }

          // Check stop reason
          if (response.stop_reason === "end_turn" && toolUseBlocks.length === 0) {
            continueLoop = false;
          }

          // Safety limit
          if (messages.length > 30) {
            continueLoop = false;
          }
        }

        // Parse actions from response
        const { text, actions } = parseActionsFromResponse(finalResponse);

        // Execute actions
        const executedActions: BuilderAction[] = [];
        for (const action of actions) {
          try {
            executeAction(action, context);
            executedActions.push(action);
          } catch (e) {
            console.error(`Failed to execute action ${action.type}:`, e);
          }
        }

        const result: ChatResponse = {
          response: text,
          actions: executedActions.length > 0 ? executedActions : undefined,
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

async function handleToolCall(
  toolName: string,
  input: Record<string, unknown>,
  context: ServerContext
): Promise<unknown> {
  switch (toolName) {
    case "list_skills": {
      const skills = context.skillRegistry.listSkills();
      return skills.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        triggers: s.triggers,
        mcpServers: s.mcpServers,
        notifications: s.notifications,
      }));
    }

    case "get_skill": {
      const skillId = input.skill_id as string;
      const skill = context.skillRegistry.getSkill(skillId);
      if (!skill) {
        return { error: `Skill ${skillId} not found` };
      }
      return skill;
    }

    case "list_mcp_servers": {
      const servers = context.mcpServerRepo.findAll();
      return servers.map((s) => ({
        id: s.id,
        name: s.name,
        description: s.description,
        command: s.command,
        args: s.args,
        enabled: s.enabled,
        // Don't expose env values (contain secrets)
        hasEnvVars: Object.keys(s.env).length > 0,
        envKeys: Object.keys(s.env),
      }));
    }

    case "list_events": {
      const limit = (input.limit as number) || 10;
      const events = await context.eventRepo.list({ limit, offset: 0 });
      return events.map((e) => ({
        id: e.id,
        source: e.source,
        type: e.type,
        status: e.status,
        createdAt: new Date(e.createdAt).toISOString(),
      }));
    }

    case "list_runs": {
      const limit = (input.limit as number) || 10;
      const skillId = input.skill_id as string | undefined;
      const runs = await context.runRepo.list({ limit, offset: 0, skillId });
      return runs.map((r) => ({
        id: r.id,
        skillId: r.skillId,
        eventId: r.eventId,
        status: r.status,
        error: r.error,
        startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : null,
        completedAt: r.completedAt ? new Date(r.completedAt).toISOString() : null,
      }));
    }

    case "get_run": {
      const runId = input.run_id as string;
      const run = await context.runRepo.findById(runId);
      if (!run) {
        return { error: `Run ${runId} not found` };
      }
      return {
        ...run,
        input: run.input ? (JSON.parse(run.input) as unknown) : null,
        output: run.output ? (JSON.parse(run.output) as unknown) : null,
        toolCalls: run.toolCalls ? (JSON.parse(run.toolCalls) as unknown[]) : [],
      };
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

function parseActionsFromResponse(response: string): { text: string; actions: BuilderAction[] } {
  const actions: BuilderAction[] = [];

  // Look for ```actions block
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

    // Remove the actions block from the text
    const text = response.replace(/```actions\s*\n[\s\S]*?\n```/, "").trim();
    return { text, actions };
  }

  return { text: response, actions: [] };
}

function executeAction(action: BuilderAction, context: ServerContext): void {
  switch (action.type) {
    case "create_skill": {
      const data = action.data as {
        name: string;
        description: string | undefined;
        instructions: string;
        triggers: Array<{
          source: string;
          events?: string[];
          schedule?: string;
          filters?: { repository?: string; ref?: string[] };
        }>;
        mcpServers:
          | string[]
          | Record<string, { command: string; args: string[]; env: Record<string, string> }>
          | undefined;
        toolPermissions: { allow: string[]; deny: string[] } | undefined;
        notifications: { onComplete: boolean; onError: boolean } | undefined;
      };

      context.skillRegistry.registerSkill({
        id: "", // Will be generated
        name: data.name,
        description: data.description,
        instructions: data.instructions,
        triggers: data.triggers,
        mcpServers: data.mcpServers ?? [],
        toolPermissions: data.toolPermissions ?? { allow: ["*"], deny: [] },
        notifications: data.notifications ?? { onComplete: false, onError: true },
      });
      break;
    }

    case "update_skill": {
      const idValue = action.data.id;
      if (typeof idValue !== "string" || !idValue) {
        throw new Error("update_skill requires an id");
      }
      const { id: _id, ...updates } = action.data;
      void _id;
      context.skillRegistry.updateSkill(idValue, updates);
      break;
    }

    case "create_mcp_server": {
      const data = action.data as {
        name: string;
        description?: string;
        command: string;
        args?: string[];
        env?: Record<string, string>;
      };

      const existing = context.mcpServerRepo.findByName(data.name);
      if (existing) {
        throw new Error(`MCP server with name "${data.name}" already exists`);
      }

      const createInput: Parameters<typeof context.mcpServerRepo.create>[0] = {
        name: data.name,
        command: data.command,
      };
      if (data.description !== undefined) createInput.description = data.description;
      if (data.args !== undefined) createInput.args = data.args;
      if (data.env !== undefined) createInput.env = data.env;

      context.mcpServerRepo.create(createInput);
      break;
    }

    case "update_mcp_server": {
      const idValue = action.data.id;
      if (typeof idValue !== "string" || !idValue) {
        throw new Error("update_mcp_server requires an id");
      }
      const { id: _id, ...updates } = action.data;
      void _id;
      context.mcpServerRepo.update(idValue, updates);
      break;
    }

    default: {
      const unknownType: string = action.type as string;
      console.warn(`Unknown action type: ${unknownType}`);
    }
  }
}
