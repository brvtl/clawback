# Clawback - Claude Code Instructions

## Project Overview

Clawback is an event-driven Claude automation engine. It receives webhook events (GitHub, Slack, etc.), routes them to matching skills, executes skills using the Claude Agent SDK with MCP tools, and notifies users of results.

## Architecture

```
apps/daemon/     - Fastify backend, skill executor, webhook handlers
apps/web/        - SvelteKit frontend, skill builder UI
packages/shared/ - Shared types, Zod schemas, MCP server registry
packages/db/     - Drizzle ORM, SQLite, repositories
```

## Key Concepts

### Skills

- Define automation behaviors triggered by events
- Contain: name, description, instructions (prompt), triggers, MCP servers, tool permissions
- Created via web UI (AI builder), API, or file system

### Events

- Incoming webhooks from sources (github, slack, custom)
- Stored in SQLite, routed to matching skills

### Runs

- Execution record of a skill processing an event
- Tracks status, input, output, tool calls

### MCP Servers

- External tool providers (GitHub, filesystem, etc.)
- Configured globally, referenced by skills by name
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
- `McpServerRepository` - MCP server CRUD with encrypted env vars

### Skill Execution Flow

1. Webhook received → `apps/daemon/src/routes/webhook.ts`
2. Event created → `packages/db/src/repositories/event.repository.ts`
3. Skill matched → `apps/daemon/src/skills/router.ts`
4. Skill executed → `apps/daemon/src/skills/executor.ts`
5. Run recorded → `packages/db/src/repositories/run.repository.ts`

### MCP Server Resolution

Skills reference MCP servers by name (e.g., `["github"]`). The executor resolves these to full configs from the database. See `executor.ts` lines 184-230.

## Testing

- Unit tests with Vitest
- Test files: `*.test.ts` alongside source files
- Run: `pnpm test:run` or `pnpm test` (watch mode)

## Important Files

- `apps/daemon/src/skills/executor.ts` - Core skill execution, Claude Agent SDK integration
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

## Gotchas

- MCP env vars must match what the server expects (e.g., `GITHUB_PERSONAL_ACCESS_TOKEN` not `GITHUB_TOKEN`)
- Skill triggers use event types like `pull_request.opened`, not `pull_request` with action filter
- Repository filters are case-sensitive (`brvtl/ArchDotfiles` not `brvtl/archdotfiles`)
- The Claude Agent SDK spawns a subprocess; MCP server errors may appear in stderr
