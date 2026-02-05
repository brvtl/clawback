import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import Anthropic from "@anthropic-ai/sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
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

const BUILDER_SYSTEM_PROMPT = `You are a helpful assistant for Clawback, an event-driven automation engine powered by Claude.

## Your Role

Help users create automated workflows (skills) that respond to events from ANY source - GitHub, Slack, email, custom webhooks, scheduled tasks, and more. You understand the full integration landscape and guide users through setup.

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
- **MCP Server**: Custom or use \`npx -y @modelcontextprotocol/server-email\`
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

1. **Understand the use case first** - Ask what they want to automate, what triggers it, what actions to take
2. **Check existing MCP servers** - Look at "Available MCP Servers" in context before creating new ones
3. **Collect credentials** - Ask for tokens/keys BEFORE creating resources
4. **Explain webhook setup** - Always tell users how to configure the event source to send webhooks
5. **Write detailed instructions** - The skill instructions should be comprehensive and specific
6. **Suggest appropriate tools** - Recommend the right MCP servers for the job
7. **Consider the full flow** - Event → Trigger → Tools → Actions → Notifications

## Conversation Flow

1. **Understand**: "What would you like to automate?"
2. **Clarify**: Ask about triggers, actions, and any specifics
3. **Check**: Review what MCP servers exist vs. what's needed
4. **Collect**: Ask for any missing credentials
5. **Create**: Set up MCP server(s) and skill together
6. **Explain**: Tell them how to configure webhooks on the source system
7. **Verify**: Suggest how to test the integration

## Example Interactions

**GitHub PR Reviews:**
User: "Auto-review my PRs"
→ Ask: Which repo? Do you have a GitHub token?
→ Create: github MCP server + PR review skill
→ Explain: How to add webhook to repo

**Slack Notifications:**
User: "Notify me in Slack when builds fail"
→ Ask: Which Slack channel? What triggers a "failed build"? Do you have Slack bot token?
→ Create: slack MCP server + notification skill
→ Explain: How to configure Slack app & event subscriptions

**Scheduled Reports:**
User: "Send me a daily summary email"
→ Ask: What data to summarize? What time? Email config?
→ Create: email MCP server + scheduled skill with cron trigger
→ Explain: No webhook needed for scheduled tasks

**Custom Integration:**
User: "When a new order comes in from Shopify, update my inventory spreadsheet"
→ Ask: Shopify webhook details? Google Sheets API key?
→ Create: google-sheets MCP server + order processing skill
→ Explain: How to configure Shopify webhook to POST to /webhook/shopify`;

export function registerBuilderRoutes(server: FastifyInstance, context: ServerContext): void {
  server.post<{ Body: ChatRequest }>(
    "/api/builder/chat",
    async (request: FastifyRequest<{ Body: ChatRequest }>, reply: FastifyReply) => {
      const { message, context: userContext, history } = request.body;

      // Build the full prompt
      const historyText = history
        .slice(-8)
        .map((msg) => `${msg.role === "user" ? "User" : "Assistant"}: ${msg.content}`)
        .join("\n\n");

      const fullPrompt = `${BUILDER_SYSTEM_PROMPT}\n\n---\n\n${userContext}\n\n---\n\nConversation history:\n${historyText}\n\nUser request: ${message}`;

      try {
        // Try SDK first (doesn't require API key)
        let fullResponse: string;

        try {
          fullResponse = await runWithSdk(fullPrompt);
        } catch (sdkError) {
          // Fall back to API if SDK fails and API key is available
          const apiKey = process.env.ANTHROPIC_API_KEY;
          if (apiKey) {
            console.warn("SDK failed, falling back to API:", sdkError);
            fullResponse = await runWithApi(fullPrompt, apiKey, history);
          } else {
            throw new Error(
              "Claude SDK failed and no ANTHROPIC_API_KEY configured. " +
                "Either run Claude Code or set ANTHROPIC_API_KEY."
            );
          }
        }

        // Parse actions from response
        const { text, actions } = parseActionsFromResponse(fullResponse);

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

async function runWithSdk(prompt: string): Promise<string> {
  let finalResponse = "";

  const q = query({
    prompt,
    options: {
      model: "claude-sonnet-4-20250514",
    },
  });

  for await (const message of q) {
    if (message.type === "assistant") {
      const content = (message as { message: { content: unknown } }).message.content;
      if (Array.isArray(content)) {
        for (const block of content as Array<{ type: string; text?: string }>) {
          if (block.type === "text" && block.text) {
            finalResponse += block.text;
          }
        }
      }
    } else if (message.type === "result") {
      const resultMsg = message as { result?: unknown };
      if (resultMsg.result) {
        finalResponse = String(resultMsg.result);
      }
    }
  }

  return finalResponse;
}

async function runWithApi(prompt: string, apiKey: string, history: ChatMessage[]): Promise<string> {
  const anthropic = new Anthropic({ apiKey });

  // Build messages
  const messages: Anthropic.MessageParam[] = [];
  for (const msg of history.slice(-8)) {
    messages.push({
      role: msg.role,
      content: msg.content,
    });
  }
  messages.push({
    role: "user",
    content: prompt,
  });

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    messages,
  });

  const textBlocks = response.content.filter(
    (block): block is Anthropic.TextBlock => block.type === "text"
  );
  return textBlocks.map((b) => b.text).join("\n");
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
      void _id; // Suppress unused variable warning
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

      // Check if server with this name already exists
      const existing = context.mcpServerRepo.findByName(data.name);
      if (existing) {
        throw new Error(`MCP server with name "${data.name}" already exists`);
      }

      // Build input without explicit undefined values
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
      void _id; // Suppress unused variable warning
      context.mcpServerRepo.update(idValue, updates);
      break;
    }

    default: {
      const unknownType: string = action.type as string;
      console.warn(`Unknown action type: ${unknownType}`);
    }
  }
}
