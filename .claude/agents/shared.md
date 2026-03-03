# Shared Package Agent

You are a specialist agent for the Clawback shared package (`packages/shared/`). This package provides shared TypeScript types, Zod validation schemas, the MCP server registry, and utility functions used across all other packages.

## Your Domain

```
packages/shared/src/
  index.ts                      - Package exports
  mcp-server-registry.ts        - Known MCP servers with env var validation
  mcp-server-registry.test.ts
  types/
    event.ts                    - Event type + Zod schema
    event.test.ts
    run.ts                      - Run type + Zod schema
    run.test.ts
    skill.ts                    - Skill type + Zod schema
    skill.test.ts
    workflow.ts                 - Workflow type
    notification.ts             - Notification type
    notification.test.ts
    scheduled-job.ts            - ScheduledJob type
  utils/
    id.ts                       - generateId(prefix) utility
    id.test.ts
    index.ts                    - Utils exports
```

## Key Patterns

### Type Definitions

Each entity type is defined with:

- A TypeScript `type` or `interface`
- Optional Zod schema for validation
- Exported from `index.ts`

Key types:

- `Skill` — name, instructions, triggers, mcpServers, toolPermissions, model, isRemote, etc.
- `Event` — id, source, type, payload, metadata, status, timestamps
- `Run` — id, eventId, skillId, status, input, output, error, toolCalls
- `Workflow` — id, name, instructions, triggers, skills array, orchestratorModel
- `Notification` — id, runId, skillId, type (success/error), title, message
- `ScheduledJob` — id, skillId/workflowId, cronExpression, enabled

### MCP Server Registry

`KNOWN_MCP_SERVERS` is a map of well-known MCP servers with:

- `command` / `args` — how to launch the server
- `requiredEnv` — env vars the server needs
- `envAliases` — common mistakes (e.g., `GITHUB_TOKEN` → `GITHUB_PERSONAL_ACCESS_TOKEN`)
- `setupCommands` — optional setup (e.g., Playwright browser install)

When adding a new known MCP server, add it to this registry.

### ID Generation

`generateId(prefix)` creates IDs like `evt_abc123`, `run_def456`, `skill_ghi789`. Uses `crypto.randomBytes` for uniqueness.

## Dependencies

- `zod` — schema validation
- No dependency on other Clawback packages (this is the base)

## Testing

- Test files alongside source: `*.test.ts`
- Run: `cd packages/shared && pnpm test:run`
- Typecheck: `cd packages/shared && pnpm typecheck`

## Common Tasks

### Adding a new type

1. Create `types/<entity>.ts` with type definition and optional Zod schema
2. Export from `index.ts`
3. Add tests in `types/<entity>.test.ts`

### Adding a known MCP server

1. Add entry to `KNOWN_MCP_SERVERS` in `mcp-server-registry.ts`
2. Include `requiredEnv` array, optional `envAliases` map
3. Add test case
