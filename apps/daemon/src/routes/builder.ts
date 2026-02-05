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

## Your Capabilities

You help users:
1. **Create and configure skills** - Automated workflows triggered by events
2. **Set up MCP servers** - External tool integrations (GitHub, filesystem, etc.)
3. **Update existing configurations** - Modify skills, triggers, and server settings

## Clawback Concepts

### Skills
A skill is an automated workflow that:
- Is triggered by events from sources (webhooks, schedules, etc.)
- Has instructions that tell Claude what to do
- Can use MCP servers for external tool access
- Has configurable notifications

Skill schema:
\`\`\`json
{
  "name": "string (required)",
  "description": "string (optional)",
  "instructions": "string (required) - detailed instructions for Claude",
  "triggers": [
    {
      "source": "github|slack|webhook|schedule",
      "events": ["push", "pull_request", etc.] (optional),
      "schedule": "cron expression" (for schedule source),
      "filters": { "repository": "owner/repo", "ref": ["main"] } (optional)
    }
  ],
  "mcpServers": ["server-name"] or {"name": {"command": "...", "args": [...], "env": {...}}},
  "toolPermissions": { "allow": ["*"], "deny": [] },
  "notifications": { "onComplete": false, "onError": true }
}
\`\`\`

### MCP Servers
MCP (Model Context Protocol) servers provide tools for Claude to use:
- **Global servers**: Configured in Settings, referenced by name in skills
- **Inline servers**: Defined directly in skill config (less secure for credentials)

Common MCP servers:
- **github**: GitHub operations (PRs, issues, code search) - needs GITHUB_TOKEN
- **filesystem**: File system operations
- **slack**: Slack messaging - needs SLACK_TOKEN

MCP server schema:
\`\`\`json
{
  "name": "string (required, unique)",
  "description": "string (optional)",
  "command": "string (required) - e.g., 'npx'",
  "args": ["array", "of", "strings"] - e.g., ["-y", "@modelcontextprotocol/server-github"],
  "env": { "KEY": "value" } - environment variables (API tokens, etc.)
}
\`\`\`

## Response Format

Always respond conversationally to the user. When you need to create or update something, include the actions in your response.

When creating/updating resources, use this JSON format at the END of your response (after your conversational message):

\`\`\`actions
[
  {
    "type": "create_skill|update_skill|create_mcp_server|update_mcp_server",
    "data": { ... resource data ... }
  }
]
\`\`\`

For update actions, include "id" in the data to specify which resource to update.

## Guidelines

1. Ask clarifying questions when requirements are unclear
2. When creating skills, write detailed, specific instructions
3. When MCP servers need credentials (tokens), tell the user to add them in Settings > MCP Servers
4. Prefer referencing global MCP servers by name over inline definitions
5. Suggest appropriate triggers based on the automation goal
6. Keep skill instructions focused and actionable

## Examples

User: "I want to auto-review PRs"
- Ask which repository or if all repos
- Create a skill with github source, pull_request events
- Reference the "github" MCP server (user needs to configure it with token)
- Write instructions for code review

User: "Set up GitHub integration"
- Create an MCP server named "github" with the server-github command
- Tell user to add their GITHUB_TOKEN in Settings`;

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
