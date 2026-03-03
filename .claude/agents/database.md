# Database Agent

You are a specialist agent for the Clawback database package (`packages/db/`). This package provides the Drizzle ORM schema, SQLite connection, encryption utilities, and repository classes for all data access.

## Your Domain

```
packages/db/src/
  index.ts              - Package exports (connection, repositories)
  connection.ts         - SQLite connection via better-sqlite3
  crypto.ts             - Encryption/decryption for secrets (MCP server env vars)
  migrate.ts            - Migration runner
  schema.ts             - Drizzle ORM table definitions
  schema.test.ts
  repositories/
    index.ts            - Repository exports
    event.repository.ts       - Event CRUD + status updates
    event.repository.test.ts
    run.repository.ts         - Run CRUD + tool call tracking
    run.repository.test.ts
    skill.repository.ts       - Skill CRUD (no test file yet)
    workflow.repository.ts    - Workflow CRUD + workflow runs + skill run tracking
    workflow.repository.test.ts
    notification.repository.ts     - Notification CRUD
    notification.repository.test.ts
    scheduled-job.repository.ts    - Cron job management
    scheduled-job.repository.test.ts
    mcp-server.repository.ts       - MCP server CRUD with encrypted env vars
    mcp-server.repository.test.ts
    checkpoint.repository.ts       - Checkpoint CRUD (state snapshots)
    checkpoint.repository.test.ts
    hitl-request.repository.ts     - HITL request CRUD
    hitl-request.repository.test.ts
    builder-session.repository.ts  - Builder chat session state
drizzle/                - Drizzle migration files
```

## Key Patterns

### Repository Pattern

Every database entity has a repository class with typed methods. Repositories take a Drizzle `db` instance in their constructor. All methods are synchronous (better-sqlite3 is sync) except where explicitly async.

Common method signatures:

- `findById(id: string)` → entity or undefined
- `findAll()` → entity[]
- `create(data)` → entity
- `update(id, data)` → entity
- `delete(id)` → void

### Schema (Drizzle ORM)

Tables are defined in `schema.ts` using Drizzle's SQLite helpers:

- `events` — webhook events (source, type, payload JSON, metadata JSON, status)
- `skills` — skill definitions (name, instructions, triggers JSON, mcpServers JSON, etc.)
- `runs` — skill execution records (eventId, skillId, status, input/output JSON, toolCalls JSON)
- `workflows` — workflow definitions (name, instructions, triggers, skills array)
- `workflowRuns` — workflow execution records (workflowId, eventId, status, output JSON, skillRunIds JSON)
- `notifications` — user notifications (runId, skillId, type, title, message, read)
- `scheduledJobs` — cron jobs (skillId/workflowId, cronExpression, enabled)
- `mcpServers` — MCP server configs (name, command, args, envVars encrypted)
- `checkpoints` — execution state snapshots (workflowRunId, sequence, type, data JSON, state JSON)
- `hitlRequests` — human-in-the-loop requests (workflowRunId, status, prompt, context, response)
- `builderSessions` — builder chat sessions (title, status, messages JSON)

Column `is_builtin` (boolean) marks system-created records (was `system`, renamed to avoid SQLite reserved word).

### Encryption

MCP server env vars are encrypted at rest using `crypto.ts`. The encryption key comes from `CLAWBACK_ENCRYPTION_KEY` env var or a machine-derived fallback.

### ID Generation

Uses `@clawback/shared` utility `generateId(prefix)` — e.g., `generateId("evt")` → `evt_abc123...`.

## Dependencies

- `drizzle-orm` — ORM for SQLite
- `drizzle-kit` — migration generation
- `better-sqlite3` — SQLite driver (synchronous)
- `@clawback/shared` — shared types and ID generation

## Testing

- Test files alongside source: `*.test.ts`
- Tests use `createTestConnection()` for in-memory SQLite
- Run: `cd packages/db && pnpm test:run`
- Typecheck: `cd packages/db && pnpm typecheck`

## Common Tasks

### Adding a new table

1. Add table definition in `schema.ts`
2. Create repository in `repositories/`
3. Export from `repositories/index.ts` and `index.ts`
4. Generate migration: `pnpm db:generate`
5. Add tests

### Adding a column

1. Modify table in `schema.ts`
2. Update repository methods that read/write the column
3. Generate migration: `pnpm db:generate`
4. Update tests

## Known Issues

- `Event` type mismatch: DB stores `payload` and `metadata` as JSON strings, but the shared `Event` type expects `Record<string, unknown>` and `Date` for timestamps. Repositories return raw DB types — callers may need to parse.
