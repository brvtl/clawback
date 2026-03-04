# Clawback - Claude Code Instructions

## Project Overview

Clawback is an event-driven Claude automation engine. It receives webhook events (GitHub, Slack, etc.), routes them to matching skills or workflows, executes them via a pluggable AI engine (direct Anthropic API or Agent SDK), and notifies users of results.

## Architecture

```
apps/daemon/           - Fastify backend, skill/workflow executor, webhook handlers
  src/ai/              - AiEngine abstraction (DirectApiEngine, AgentSdkEngine)
  src/skills/          - Skill executor, registry
  src/services/        - Workflow executor, builder, scheduler, notifications
  src/routes/          - API, webhook, builder routes
  src/mcp/             - MCP server process management
apps/web/              - SvelteKit frontend, builder UI
packages/shared/       - Shared types, Zod schemas, MCP server registry
packages/db/           - Drizzle ORM, SQLite, repositories
packages/mcp-server/   - Clawback MCP server for external tool access
```

## Subagents (MANDATORY for implementation)

**Always delegate implementation work to the appropriate subagent.** The main context window should be used for planning, coordination, and verification — not for reading/writing code directly. Each subagent (`.claude/agents/`) knows its domain's files, patterns, and conventions.

**Rules:**

- For ANY code change, delegate to the matching subagent below
- For cross-domain changes, spawn multiple subagents in parallel (one per domain)
- Only read/write code in the main context for trivial single-line fixes or when no subagent matches
- Give each subagent a clear, complete task description — it runs independently

| Agent        | Domain                                                    | Use when                                                              |
| ------------ | --------------------------------------------------------- | --------------------------------------------------------------------- |
| `ai-engine`  | AiEngine interface, DirectApiEngine, AgentSdkEngine       | Modifying `src/ai/` — engine implementations, MCP connections, HITL   |
| `daemon`     | Backend server, executors, routes, services               | Modifying daemon logic, adding API endpoints, changing execution flow |
| `web`        | SvelteKit frontend, Svelte components, stores, API client | Modifying UI pages, adding components, updating stores                |
| `database`   | Drizzle schema, repositories, migrations                  | Adding tables/columns, new repositories, migration work               |
| `shared`     | Shared types, Zod schemas, MCP server registry            | Modifying shared types, adding MCP server definitions                 |
| `mcp-server` | Clawback MCP server tools                                 | Adding/modifying MCP tools exposed by Clawback                        |

## AI Engine (Dual-Mode Execution)

All AI execution goes through the `AiEngine` interface (`apps/daemon/src/ai/types.ts`). A factory function selects the implementation based on environment variables:

- `ANTHROPIC_API_KEY` set → `DirectApiEngine` — calls Anthropic API directly, per-token billing
- `CLAUDE_CODE_OAUTH_TOKEN` set → `AgentSdkEngine` — uses Claude Agent SDK, bills against Max subscription. The token value is only used for engine selection; the spawned `claude` CLI handles its own auth internally.
- Neither set → AI features disabled (graceful degradation)

```
apps/daemon/src/ai/
  types.ts           - AiEngine interface, LoopConfig, LoopObserver, LoopResult, CustomToolDef
  direct-engine.ts   - DirectApiEngine (MCP connections, message loop, tool permissions)
  sdk-engine.ts      - AgentSdkEngine (Agent SDK query(), Zod schema conversion)
  index.ts           - createAiEngine() factory + re-exports
```

Executors (SkillExecutor, WorkflowExecutor, BuilderExecutor) call `engine.runLoop(config, observer)` and never import SDK-specific code. The observer pattern provides checkpoints, and custom tools enable workflow orchestration.

## Key Concepts

### Skills

- Single-purpose automations triggered by events
- Contain: name, description, instructions (prompt), triggers, MCP servers, tool permissions
- Created via web UI (AI builder) or API
- Executed via AiEngine with MCP tool integration
- Can include knowledge files for additional context
- Tool permissions use glob patterns (e.g., `["mcp__github__*"]` to allow all GitHub tools)
- Model selection per-skill: `haiku` (fast/cheap), `sonnet` (balanced, default), `opus` (most capable)

### Remote Skills

- Skills can be imported from URLs (e.g., GitHub raw files)
- AI security review analyzes imported skills for risks
- Review checks: data exfiltration, malicious code, privilege escalation
- Remote skills run with restricted tool permissions by default
- Content hash tracks changes for re-review

### Workflows

- AI-orchestrated multi-skill automations
- Use Claude (Opus/Sonnet) as orchestrator with custom tools: `spawn_skill`, `complete_workflow`, `fail_workflow`, `request_human_input`
- Custom tools are passed as `CustomToolDef[]` to `engine.runLoop()` — handlers are closures over executor state
- Can run skills in parallel or sequence based on orchestrator instructions
- Triggered by events same as skills
- Can pause for human input via `request_human_input` tool (status: `waiting_for_input`)

### Events

- Incoming webhooks from sources (github, slack, custom)
- Cron-scheduled events (source: "cron", type: "scheduled")
- Stored in SQLite, routed to matching skills/workflows

### Scheduled Jobs

- Both skills and workflows can have cron triggers
- Managed via `/schedules` page in web UI
- Jobs can be enabled/disabled without deletion
- Scheduler syncs jobs from skills/workflows at startup

### Runs

- Execution record of a skill processing an event
- Tracks status, input, output, tool calls

### Workflow Runs

- Execution record of a workflow
- Contains array of skill run IDs spawned by orchestrator
- Output includes summary, results, and individual skill outputs
- Status can be `waiting_for_input` when paused for HITL

### Checkpoints

- Full state snapshots saved at every execution step (LangGraph-inspired)
- Stored in `checkpoints` table with type, data, and optional full conversation state
- Types: `assistant_message`, `tool_call`, `tool_result`, `skill_spawn`, `skill_complete`, `hitl_request`, `hitl_response`, `error`
- Broadcast over WebSocket for live UI updates
- Any checkpoint with state is a valid resume point

### Human-in-the-Loop (HITL)

- Workflows can call `request_human_input` tool to pause and ask for human guidance
- The tool handler returns `{ type: "pause" }` — the engine stops the loop and returns `result.paused = true`
- Executor extracts HITL context from `result.messages`, creates checkpoint + HITL request in DB
- Human responds via `/hitl` page or API → workflow resumes from saved messages
- Daemon restart safe: state lives in DB, pending requests survive restarts

### MCP Servers

- External tool providers (GitHub, filesystem, etc.)
- Configured globally, referenced by skills/workflows by name
- Env vars auto-fixed for known servers (e.g., GITHUB_TOKEN → GITHUB_PERSONAL_ACCESS_TOKEN)
- Env vars support `${VAR}` placeholder syntax for secrets
- Known servers can have `setupCommands` (e.g., Playwright auto-installs browsers)

### Clawback MCP Server

- `packages/mcp-server/` exposes Clawback API as MCP tools
- Used by the AI Builder to create/update skills, workflows, MCP servers
- Tools: list_skills, get_skill, list_runs, list_events, create_skill, etc.
- Connect via: `CLAWBACK_API_URL` env var (default: http://localhost:3000)

### AI Builder

- Chat interface at `/builder` for creating automations
- Uses AiEngine with custom tools (same pattern as workflows)
- Can create skills, workflows, and MCP servers via conversation
- Returns structured actions that the frontend applies

### Notifications

- Real-time notifications via WebSocket
- Desktop notifications via node-notifier
- Configurable per-skill: `onComplete`, `onError` flags
- Stored in database, viewable in web UI header

## Web UI Pages

- `/` - Dashboard with recent activity
- `/builder` - AI chat for creating automations
- `/skills` - List and manage skills
- `/skills/[id]` - Skill detail and runs
- `/workflows` - List and manage workflows
- `/workflows/[id]` - Workflow detail and runs
- `/events` - List incoming events
- `/events/[id]` - Event detail
- `/runs` - List skill execution runs
- `/runs/[id]` - Run detail with tool calls and checkpoint timeline
- `/hitl` - Human input requests with conversation context
- `/schedules` - View and manage cron jobs
- `/settings` - MCP server configuration

## Development Commands

```bash
pnpm dev          # Start daemon (port 3000)
pnpm dev:web      # Start web UI (port 5173)
pnpm test:run     # Run tests
pnpm lint         # Lint code
pnpm typecheck    # Type check all packages
```

## Code Patterns

### Repository Pattern

Database access goes through repositories in `packages/db/src/repositories/`:

- `EventRepository` - event CRUD
- `RunRepository` - run CRUD + tool calls
- `SkillRepository` - skill CRUD
- `WorkflowRepository` - workflow CRUD + workflow runs
- `ScheduledJobRepository` - cron job management
- `McpServerRepository` - MCP server CRUD with encrypted env vars
- `CheckpointRepository` - checkpoint CRUD (state snapshots)
- `HitlRequestRepository` - human-in-the-loop request CRUD

### Skill Execution Flow

1. Webhook received → `apps/daemon/src/routes/webhook.ts`
2. Event created → `packages/db/src/repositories/event.repository.ts`
3. Skill matched → `apps/daemon/src/skills/registry.ts`
4. Skill executed → `apps/daemon/src/skills/executor.ts` (calls `engine.runLoop()`)
5. Run recorded → `packages/db/src/repositories/run.repository.ts`

### Workflow Execution Flow

1. Event triggers workflow → `apps/daemon/src/workflows/registry.ts`
2. Workflow executor starts → `apps/daemon/src/services/workflow-executor.ts`
3. Builds `CustomToolDef[]` with handlers (closures over executor state)
4. Calls `engine.runLoop()` with custom tools + observer for checkpoints
5. If `result.paused`: extracts HITL context from `result.messages`, saves checkpoint, creates request
6. Human responds → workflow resumes with saved messages + human tool_result appended
7. Workflow run recorded with all skill results

### MCP Server Resolution

Skills/workflows reference MCP servers by name (e.g., `["github"]`). The executor resolves these to `McpServerConfig` objects, which the AiEngine connects to internally.

## Testing

- Unit tests with Vitest
- Test files: `*.test.ts` alongside source files
- Run: `pnpm test:run` or `pnpm test` (watch mode)
- Executors are tested by mocking the `AiEngine` interface (not the Anthropic SDK directly)

## Important Files

- `apps/daemon/src/ai/types.ts` - AiEngine interface and types
- `apps/daemon/src/ai/direct-engine.ts` - DirectApiEngine (Anthropic API)
- `apps/daemon/src/ai/sdk-engine.ts` - AgentSdkEngine (Agent SDK)
- `apps/daemon/src/ai/index.ts` - createAiEngine() factory
- `apps/daemon/src/skills/executor.ts` - Core skill execution
- `apps/daemon/src/services/workflow-executor.ts` - Workflow orchestration + HITL + checkpoints
- `apps/daemon/src/services/builder-executor.ts` - AI builder chat executor
- `apps/daemon/src/services/scheduler.ts` - Cron scheduling service
- `apps/daemon/src/server.ts` - Server wiring (creates engine, passes to executors)
- `apps/daemon/src/routes/api.ts` - REST API endpoints
- `apps/daemon/src/routes/webhook.ts` - Webhook ingestion
- `apps/daemon/src/routes/builder.ts` - AI builder chat endpoint
- `apps/daemon/src/services/remote-skill-fetcher.ts` - Fetch skills from URLs
- `apps/daemon/src/services/skill-reviewer.ts` - AI security review for remote skills
- `apps/daemon/src/services/notifications.ts` - Desktop + WebSocket notifications
- `apps/daemon/src/mcp/manager.ts` - MCP server process management
- `packages/shared/src/mcp-server-registry.ts` - Known MCP servers with env var validation
- `packages/mcp-server/src/index.ts` - Clawback MCP server implementation
- `packages/db/src/schema.ts` - Database schema

## Common Tasks

### Adding a new API endpoint

1. Add route in `apps/daemon/src/routes/api.ts`
2. Add repository method if needed in `packages/db/`
3. Add types in `packages/shared/src/types/`

### Adding a known MCP server

1. Add to `KNOWN_MCP_SERVERS` in `packages/shared/src/mcp-server-registry.ts`
2. Include `requiredEnv`, optional `envAliases` for common mistakes

### Debugging skill execution

1. Check run output in web UI or via `/api/runs/:id`
2. Look at `toolCalls` array for MCP tool usage
3. Check daemon logs for MCP server connection errors

### Debugging workflow execution

1. Check workflow run in web UI (expandable details)
2. View individual skill run outputs
3. Check `output.summary` and `output.results` for orchestrator summary

## Gotchas

- MCP env vars must match what the server expects (e.g., `GITHUB_PERSONAL_ACCESS_TOKEN` not `GITHUB_TOKEN`)
- Skill triggers use event types like `pull_request.opened`, not `pull_request` with action filter
- Use wildcard patterns for broader matching: `pull_request.*` matches `pull_request.opened`, `pull_request.closed`, etc.
- Repository filters are case-sensitive (`brvtl/ArchDotfiles` not `brvtl/archdotfiles`)
- Set either `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` — if neither is set, AI features are disabled
- `CLAUDE_CODE_OAUTH_TOKEN` is only used for engine selection — the SDK engine strips it from child processes so the `claude` CLI uses its own auth from `~/.claude/.credentials.json` (which handles token refresh). Set it to any non-empty value (e.g., `use-cli-auth`) on machines where the CLI is logged in.
- Executors never import SDK-specific code directly — always go through `AiEngine`
- The `Event` type from the DB returns `payload: string` (JSON) but the shared type expects `Record<string, unknown>` — this is a known pre-existing type mismatch
