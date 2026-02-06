# Clawback - Claude Code Instructions

## Project Overview

Clawback is an event-driven Claude automation engine. It receives webhook events (GitHub, Slack, etc.), routes them to matching skills or workflows, executes them using the Anthropic API with MCP tools, and notifies users of results.

## Architecture

```
apps/daemon/     - Fastify backend, skill/workflow executor, webhook handlers
apps/web/        - SvelteKit frontend, builder UI
packages/shared/ - Shared types, Zod schemas, MCP server registry
packages/db/     - Drizzle ORM, SQLite, repositories
packages/mcp-server/ - Clawback MCP server for external tool access
```

## Key Concepts

### Skills

- Single-purpose automations triggered by events
- Contain: name, description, instructions (prompt), triggers, MCP servers, tool permissions
- Created via web UI (AI builder) or API
- Executed using Anthropic API with MCP tool integration

### Workflows

- AI-orchestrated multi-skill automations
- Use Claude (Opus/Sonnet) as orchestrator with custom tools: `spawn_skill`, `complete_workflow`, `fail_workflow`
- Can run skills in parallel or sequence based on orchestrator instructions
- Triggered by events same as skills

### Events

- Incoming webhooks from sources (github, slack, custom)
- Cron-scheduled events (source: "cron", type: "scheduled")
- Stored in SQLite, routed to matching skills/workflows

### Runs

- Execution record of a skill processing an event
- Tracks status, input, output, tool calls

### Workflow Runs

- Execution record of a workflow
- Contains array of skill run IDs spawned by orchestrator
- Output includes summary, results, and individual skill outputs

### MCP Servers

- External tool providers (GitHub, filesystem, etc.)
- Configured globally, referenced by skills/workflows by name
- Env vars auto-fixed for known servers (e.g., GITHUB_TOKEN → GITHUB_PERSONAL_ACCESS_TOKEN)

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

### Skill Execution Flow

1. Webhook received → `apps/daemon/src/routes/webhook.ts`
2. Event created → `packages/db/src/repositories/event.repository.ts`
3. Skill matched → `apps/daemon/src/skills/registry.ts`
4. Skill executed → `apps/daemon/src/skills/executor.ts` (uses Anthropic API)
5. Run recorded → `packages/db/src/repositories/run.repository.ts`

### Workflow Execution Flow

1. Event triggers workflow → `apps/daemon/src/workflows/registry.ts`
2. Workflow executor starts → `apps/daemon/src/services/workflow-executor.ts`
3. Claude orchestrates with tools: spawn_skill, complete_workflow, fail_workflow
4. Skills spawned create synthetic events and execute
5. Workflow run recorded with all skill results

### MCP Server Resolution

Skills/workflows reference MCP servers by name (e.g., `["github"]`). The executor resolves these to full configs from the database.

## Testing

- Unit tests with Vitest
- Test files: `*.test.ts` alongside source files
- Run: `pnpm test:run` or `pnpm test` (watch mode)

## Important Files

- `apps/daemon/src/skills/executor.ts` - Core skill execution with Anthropic API
- `apps/daemon/src/services/workflow-executor.ts` - Workflow orchestration
- `apps/daemon/src/services/scheduler.ts` - Cron scheduling service
- `apps/daemon/src/routes/api.ts` - REST API endpoints
- `apps/daemon/src/routes/webhook.ts` - Webhook ingestion
- `packages/shared/src/mcp-server-registry.ts` - Known MCP servers with env var validation
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
- `ANTHROPIC_API_KEY` is required for both skill and workflow execution
