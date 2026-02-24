import Anthropic from "@anthropic-ai/sdk";
import { TOOLS, handleToolCall } from "clawback-mcp/tools";
import type {
  BuilderSessionRepository,
  WorkflowRepository,
  CheckpointRepository,
  EventRepository,
} from "@clawback/db";
import { callWithRetry } from "../skills/executor.js";
import type { NotificationService } from "./notifications.js";

export interface BuilderExecutorDependencies {
  builderSessionRepo: BuilderSessionRepository;
  notificationService: NotificationService;
  anthropicApiKey?: string;
  workflowRepo: WorkflowRepository;
  checkpointRepo: CheckpointRepository;
  eventRepo: EventRepository;
  builderWorkflowId: string;
}

// Convert MCP tool schemas to Anthropic tool format
const BUILDER_TOOLS: Anthropic.Tool[] = [
  {
    name: "fetch_url",
    description:
      "Fetch content from a URL. Use this to read API documentation, skill definitions, or any web content the user references.",
    input_schema: {
      type: "object" as const,
      properties: {
        url: {
          type: "string",
          description: "The URL to fetch",
        },
      },
      required: ["url"],
    },
  },
  ...TOOLS.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
  })),
];

async function handleBuilderToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (name === "fetch_url") {
    const url = args.url as string;
    const response = await fetch(url, {
      headers: { Accept: "text/plain, text/markdown, application/json, text/html" },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const text = await response.text();
    const maxLen = 30_000;
    if (text.length > maxLen) {
      return text.slice(0, maxLen) + `\n\n... (truncated, ${text.length} total characters)`;
    }
    return text;
  }
  return handleToolCall(name, args);
}

const BUILDER_SYSTEM_PROMPT = `You are a helpful assistant for Clawback, an event-driven automation engine powered by Claude.

## Your Role

Help users create automated workflows and skills that respond to events from ANY source - GitHub, Slack, email, custom webhooks, scheduled tasks, and more. You understand the full integration landscape and guide users through setup.

## Tools Available

You have access to the following tools:

### Web Access
- **fetch_url**: Fetch content from any URL — use this to read API docs, skill definitions, or platform references the user provides

### Skills & Execution
- **list_skills**: See all configured skills
- **get_skill**: Get full details of a skill (including instructions)
- **list_runs**: See recent skill executions
- **get_run**: Get details of a specific run
- **create_skill**: Create a new skill

### Workflows (AI-Orchestrated Multi-Skill Automations)
- **list_workflows**: See all configured workflows
- **get_workflow**: Get full details of a workflow and its skills
- **create_workflow**: Create a new workflow with AI orchestration
- **trigger_workflow**: Manually run a workflow
- **list_workflow_runs**: See recent workflow executions

### Infrastructure
- **list_mcp_servers**: See configured MCP servers
- **list_events**: See recent events received
- **get_status**: Get system status
- **create_mcp_server**: Create a new MCP server configuration

Use these tools to understand the current state and make changes!

## Clawback Architecture

### How It Works
1. **Events come in** via webhooks, schedules, or API calls
2. **Skills or Workflows match events** based on triggers (source, event type, filters)
3. For skills: **Claude executes** the skill's instructions using available tools
4. For workflows: **AI orchestrator** coordinates multiple skills intelligently
5. **Results** are stored and notifications sent

### Skills vs Workflows

**Skills** are single-purpose automations:
- One trigger → one execution
- Direct access to MCP tools
- Good for simple, focused tasks

**Workflows** are AI-orchestrated multi-skill automations:
- One trigger → intelligent coordination of multiple skills
- An AI orchestrator (Opus or Sonnet) decides which skills to run and in what order
- Good for complex processes that need decision-making and coordination
- Example: "When a new issue is labeled 'customer', extract info, create CRM contact, notify sales, and update the issue"

**Decision rule**: If the user's request involves 2+ distinct steps, uses multiple tools/integrations, or requires decision-making between actions, CREATE A WORKFLOW. Only use a standalone skill for truly single-purpose tasks.

### Skills
A skill defines WHAT to do when an event occurs:
- **triggers**: WHEN to run (event source, type, filters)
- **instructions**: WHAT Claude should do (detailed prompt)
- **mcpServers**: WHICH tools Claude can use
- **notifications**: WHO to alert on completion/error
- **model**: WHICH AI model to use: 'haiku' (fast, cheap), 'sonnet' (balanced, default), 'opus' (most capable)

### Workflows
A workflow orchestrates multiple skills with AI coordination:
- **triggers**: WHEN to run (same as skills)
- **skills**: WHICH skills the orchestrator can use
- **instructions**: HOW the AI should coordinate the skills
- **orchestratorModel**: 'opus' (most capable) or 'sonnet' (faster, cheaper)

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
- **MCP Server**: \`npx -y dkmaker-mcp-rest-api\`
- **Tool**: \`test_request\` — supports GET, POST, PUT, DELETE, PATCH with full control over method, endpoint, body, and headers
- **Credentials**:
  - \`REST_BASE_URL\` (required) — the base URL of the API (e.g., \`https://api.example.com\`)
  - Authentication (pick one): \`AUTH_BEARER\` (Bearer token), \`AUTH_BASIC_USERNAME\` + \`AUTH_BASIC_PASSWORD\` (Basic auth), or \`AUTH_APIKEY_HEADER_NAME\` + \`AUTH_APIKEY_VALUE\` (API key in custom header)
  - Custom default headers: use \`HEADER_<name>\` env vars (e.g., \`HEADER_X-Agent-Key\` becomes the \`X-Agent-Key\` header on every request)
- **Use cases**: Call any REST API, integrate with any service, post data, manage resources
- **NOTE**: This is the preferred MCP server for ANY HTTP API integration. Use it instead of the fetch server which is GET-only

### Browser Automation (Playwright)
- **MCP Server**: \`npx -y @playwright/mcp@latest --headless\`
- **Credentials**: None (runs headless browser locally)
- **Use cases**: Web scraping, form filling, UI testing, automating websites that don't have APIs
- **Capabilities**: Navigate pages, click elements, fill forms, take screenshots, extract data

### 1Password (Credential Management)
- **MCP Server**: \`npx -y @smithery/cli run @dkvdm/onepassword-mcp-server\`
- **Credentials**: OP_SERVICE_ACCOUNT_TOKEN (1Password service account token)
  - Create at: https://my.1password.com → Developer → Service Accounts
  - Grant access only to vaults the automation needs
- **Use cases**: Secure credential retrieval for automations, avoid storing passwords in Clawback
- **Security**: Credentials never stored in Clawback DB, only accessed at runtime

### Browser + 1Password (Authenticated Website Automation)
Combine Playwright and 1Password for powerful authenticated automations:

1. **Setup**: Add both MCP servers to your skill
2. **Credential retrieval**: Use 1Password tools to get login credentials
3. **Browser automation**: Use Playwright to navigate and interact with the site
4. **Example skill**: "Retrieve JIRA credentials from 1Password, log into JIRA, check for overdue issues, return summary"

**Example instructions for authenticated automation:**
\`\`\`
1. Use 1Password to retrieve the "jira-work" item from the "AI Automation" vault
2. Open a browser and navigate to the website URL from the credential
3. Log in using the retrieved username and password
4. Perform the requested action
5. Return results (never log or output the actual credentials)
\`\`\`

### Scheduled Tasks
- **No MCP server needed** - uses cron triggers
- **Trigger format**: \`{ "source": "cron", "schedule": "0 9 * * *" }\`
- **Use cases**: Daily reports, periodic cleanup, regular syncs

### Custom/Generic Webhooks
- **Webhook URL**: \`http://<host>:3000/webhook/<any-name>\`
- **Trigger**: \`{ "source": "<any-name>", "events": ["..."] }\`
- **Use cases**: Zapier, IFTTT, custom apps, IoT devices

## CRITICAL: Always Query First

**BEFORE answering ANY question about available tools, skills, or capabilities:**
1. Call \`list_mcp_servers\` to see what MCP servers are ACTUALLY configured
2. Call \`list_skills\` to see what skills ACTUALLY exist
3. Call \`list_workflows\` to see what workflows exist
4. Only then describe what's available

The "Supported Integrations" section above describes what Clawback CAN support, NOT what is currently configured. You MUST use the tools to check what's actually set up before telling the user what they have.

## Creating Workflows

When creating a workflow, ALWAYS follow this process:

1. **Query existing skills**: Call \`list_skills\` to see what skills already exist
2. **Identify reusable skills**: Look at skill names, descriptions, and triggers to find skills that can be orchestrated together
3. **Get skill details**: Use \`get_skill\` on promising skills to understand their full instructions
4. **Create missing skills first**: If the workflow needs capabilities not covered by existing skills, create those skills first
5. **Create the workflow**: Use \`create_workflow\` with:
   - The skill IDs (not names!) of skills to orchestrate
   - Clear instructions for how the AI should coordinate these skills
   - Appropriate triggers

**Example workflow creation:**
- User asks: "Create a workflow to review PRs"
- You call \`list_skills\` and find: pr-analyzer (skill_abc), code-checker (skill_def), comment-poster (skill_ghi)
- You create the workflow with skills: ["skill_abc", "skill_def", "skill_ghi"]
- Instructions explain the orchestration: "First analyze the PR, then check code quality, then post a review"

**IMPORTANT**: Never ask users for skill IDs. Always look them up yourself using the tools!

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
6. **Decide**: Choose between a skill (single task) or workflow (multi-step coordination). Default to WORKFLOW if the automation involves multiple steps, decision-making, or coordinating different actions
7. **Create**: Use create_skill for single tasks, create_workflow for multi-step automations, and create_mcp_server for new integrations
8. **Explain**: Tell them how to configure webhooks
9. **Verify**: Suggest how to test the integration`;

export class BuilderExecutor {
  private anthropic: Anthropic | null = null;
  private builderSessionRepo: BuilderSessionRepository;
  private notificationService: NotificationService;
  private workflowRepo: WorkflowRepository;
  private checkpointRepo: CheckpointRepository;
  private eventRepo: EventRepository;
  private builderWorkflowId: string;
  private activeSessions = new Set<string>();

  constructor(deps: BuilderExecutorDependencies) {
    this.builderSessionRepo = deps.builderSessionRepo;
    this.notificationService = deps.notificationService;
    this.workflowRepo = deps.workflowRepo;
    this.checkpointRepo = deps.checkpointRepo;
    this.eventRepo = deps.eventRepo;
    this.builderWorkflowId = deps.builderWorkflowId;

    if (deps.anthropicApiKey) {
      this.anthropic = new Anthropic({ apiKey: deps.anthropicApiKey });
      console.log("[BuilderExecutor] Initialized with Anthropic API key");
    } else {
      console.log(
        "[BuilderExecutor] WARNING: No ANTHROPIC_API_KEY configured - builder will not work"
      );
    }
  }

  isProcessing(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  startTurn(sessionId: string, userMessage: string): void {
    if (this.activeSessions.has(sessionId)) {
      throw new Error("Session is already processing");
    }

    // Mark as processing
    this.activeSessions.add(sessionId);
    this.builderSessionRepo.updateStatus(sessionId, "processing");
    this.broadcast(sessionId, "builder_status", { status: "processing" });

    // Load existing messages from DB
    const existingMessages = this.builderSessionRepo.getMessages(
      sessionId
    ) as Anthropic.MessageParam[];

    // Append user message
    existingMessages.push({ role: "user", content: userMessage });
    this.builderSessionRepo.updateMessages(sessionId, existingMessages);

    // Fire and forget
    void this.runLoop(sessionId, existingMessages, userMessage).catch((error) => {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error(`[BuilderExecutor] Session ${sessionId} error:`, errorMessage);
      this.builderSessionRepo.updateStatus(sessionId, "error", errorMessage);
      this.broadcast(sessionId, "builder_error", { error: errorMessage });
      this.activeSessions.delete(sessionId);
    });
  }

  private async runLoop(
    sessionId: string,
    messages: Anthropic.MessageParam[],
    userMessage: string
  ): Promise<void> {
    if (!this.anthropic) {
      throw new Error("ANTHROPIC_API_KEY is required for builder");
    }

    // Create event + workflow run for observability
    const event = await this.eventRepo.create({
      source: "builder",
      type: "chat.message",
      payload: { sessionId, message: userMessage },
      metadata: { sessionId },
    });

    const workflowRun = this.workflowRepo.createRun({
      workflowId: this.builderWorkflowId,
      eventId: event.id,
      input: { sessionId, message: userMessage },
    });
    const workflowRunId = workflowRun.id;
    this.workflowRepo.updateRunStatus(workflowRunId, "running");

    let continueLoop = true;
    let finalText = "";
    let cpSequence = this.checkpointRepo.getNextSequence(undefined, workflowRunId);

    try {
      while (continueLoop) {
        const response: Anthropic.Message = await callWithRetry(
          () =>
            this.anthropic!.messages.create({
              model: "claude-sonnet-4-20250514",
              max_tokens: 4096,
              system: BUILDER_SYSTEM_PROMPT,
              tools: BUILDER_TOOLS,
              messages,
            }),
          3,
          "builder chat"
        );

        // Extract text blocks
        const textBlocks = response.content.filter(
          (block): block is Anthropic.TextBlock => block.type === "text"
        );
        if (textBlocks.length > 0) {
          const text = textBlocks.map((b) => b.text).join("\n");
          finalText += text;
          this.broadcast(sessionId, "builder_text", { text });
          this.saveCheckpoint(workflowRunId, cpSequence++, "assistant_message", { text });
        }

        // Check for tool use
        const toolUseBlocks = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
        );

        if (toolUseBlocks.length > 0) {
          const toolResults: Anthropic.ToolResultBlockParam[] = [];

          for (const toolUse of toolUseBlocks) {
            this.broadcast(sessionId, "builder_tool_call", {
              tool: toolUse.name,
              args: toolUse.input,
            });
            this.saveCheckpoint(workflowRunId, cpSequence++, "tool_call", {
              toolName: toolUse.name,
              toolInput: toolUse.input,
              toolUseId: toolUse.id,
            });

            try {
              const result = await handleBuilderToolCall(
                toolUse.name,
                toolUse.input as Record<string, unknown>
              );
              const resultStr = JSON.stringify(result, null, 2);

              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: resultStr,
              });

              this.broadcast(sessionId, "builder_tool_result", {
                tool: toolUse.name,
                result: resultStr.length > 500 ? resultStr.slice(0, 500) + "..." : resultStr,
              });
              this.saveCheckpoint(workflowRunId, cpSequence++, "tool_result", {
                toolName: toolUse.name,
                toolUseId: toolUse.id,
                result: resultStr.length > 2000 ? resultStr.slice(0, 2000) + "..." : resultStr,
              });
            } catch (error) {
              const errMsg = error instanceof Error ? error.message : "Unknown error";
              toolResults.push({
                type: "tool_result",
                tool_use_id: toolUse.id,
                content: `Error: ${errMsg}`,
                is_error: true,
              });

              this.broadcast(sessionId, "builder_tool_result", {
                tool: toolUse.name,
                result: `Error: ${errMsg}`,
                isError: true,
              });
              this.saveCheckpoint(workflowRunId, cpSequence++, "tool_result", {
                toolName: toolUse.name,
                toolUseId: toolUse.id,
                result: `Error: ${errMsg}`,
                isError: true,
              });
            }
          }

          // Append assistant turn + tool results
          messages.push(
            { role: "assistant", content: response.content },
            { role: "user", content: toolResults }
          );

          // Persist messages after every turn
          this.builderSessionRepo.updateMessages(sessionId, messages);
        } else {
          continueLoop = false;
        }

        if (response.stop_reason === "end_turn" && toolUseBlocks.length === 0) {
          continueLoop = false;
        }
      }

      // Done: set status back to active (ready for next turn)
      this.builderSessionRepo.updateMessages(sessionId, messages);
      this.builderSessionRepo.updateStatus(sessionId, "active");

      // Auto-generate title from first user message if none set
      const session = this.builderSessionRepo.findById(sessionId);
      if (session && !session.title) {
        const firstUserMsg = messages.find(
          (m) => m.role === "user" && typeof m.content === "string"
        );
        if (firstUserMsg && typeof firstUserMsg.content === "string") {
          this.builderSessionRepo.updateTitle(sessionId, firstUserMsg.content.slice(0, 100));
        }
      }

      this.broadcast(sessionId, "builder_complete", { finalText });
      this.workflowRepo.updateRunStatus(workflowRunId, "completed", {
        output: { summary: finalText },
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      this.saveCheckpoint(workflowRunId, cpSequence++, "error", { error: errorMessage });
      this.workflowRepo.updateRunStatus(workflowRunId, "failed", { error: errorMessage });
      throw error;
    } finally {
      this.activeSessions.delete(sessionId);
    }
  }

  private saveCheckpoint(
    workflowRunId: string,
    sequence: number,
    type: "assistant_message" | "tool_call" | "tool_result" | "error",
    data: unknown
  ): void {
    const checkpoint = this.checkpointRepo.create({
      workflowRunId,
      sequence,
      type,
      data,
    });
    this.notificationService.broadcastMessage({
      type: "checkpoint",
      workflowRunId,
      checkpoint: {
        id: checkpoint.id,
        sequence,
        type: checkpoint.type,
        data,
        createdAt: checkpoint.createdAt,
      },
    });
  }

  private broadcast(sessionId: string, type: string, data: Record<string, unknown>): void {
    this.notificationService.broadcastMessage({
      type,
      sessionId,
      ...data,
    });
  }
}
