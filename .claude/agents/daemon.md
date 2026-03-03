# Daemon Agent

You are a specialist agent for the Clawback daemon backend (`apps/daemon/`). This is a Fastify server that handles webhook ingestion, skill/workflow execution, scheduling, and notifications.

## Your Domain

```
apps/daemon/src/
  index.ts              - Entry point
  server.ts             - Fastify server wiring, creates AiEngine + all executors
  ai/                   - AiEngine abstraction layer
    types.ts            - AiEngine interface, LoopConfig, LoopObserver, LoopResult, CustomToolDef
    direct-engine.ts    - DirectApiEngine (Anthropic API, MCP connections, tool loop)
    sdk-engine.ts       - AgentSdkEngine (Agent SDK query(), Zod schema conversion)
    index.ts            - createAiEngine() factory
  skills/
    executor.ts         - SkillExecutor: builds config, calls engine.runLoop()
    executor.test.ts
    registry.ts         - Matches events to skills by triggers
    registry.test.ts
  services/
    workflow-executor.ts      - Workflow orchestration with custom tools + HITL
    workflow-executor.test.ts
    builder-executor.ts       - AI builder chat (same pattern as workflows)
    builder-seeds.ts          - Built-in builder skill definitions
    scheduler.ts              - Cron scheduling service
    notifications.ts          - WebSocket + desktop notifications
    queue.ts                  - Event processing queue
    remote-skill-fetcher.ts   - Fetch skills from URLs
    skill-reviewer.ts         - AI security review for remote skills
  workflows/
    registry.ts         - Matches events to workflows
    registry.test.ts
  routes/
    api.ts              - REST API endpoints (skills, workflows, events, runs, etc.)
    webhook.ts          - Webhook ingestion (POST /webhook/:source)
    builder.ts          - Builder chat WebSocket endpoint
  mcp/
    manager.ts          - MCP server process lifecycle management
```

## Key Patterns

### AiEngine Abstraction

All AI calls go through `AiEngine.runLoop(config, observer)`. Never import `@anthropic-ai/sdk` or `@anthropic-ai/claude-agent-sdk` outside of `src/ai/`. Executors receive an `engine` instance from `server.ts`.

- `LoopConfig` — model, messages, mcpServers, customTools, toolPermissions
- `LoopObserver` — onText(), onToolCall(), onToolResult() callbacks for checkpoints
- `LoopResult` — finalText, messages, paused flag (for HITL)
- `CustomToolDef` — name, description, inputSchema, handler function

### Executor Pattern

All three executors (SkillExecutor, WorkflowExecutor, BuilderExecutor) follow the same pattern:

1. Receive dependencies via constructor (repos, engine, services)
2. Build `LoopConfig` with model, system prompt, MCP servers
3. Call `engine.runLoop(config, observer)` with observer for checkpoints
4. Handle `result.paused` for HITL (workflow/builder only)

### Custom Tools (Workflow/Builder)

Orchestrator tools are `CustomToolDef[]` built inline with handler closures:

- `spawn_skill` — async handler that calls `skillExecutor.execute()`
- `complete_workflow` — sync handler that sets final output
- `fail_workflow` — sync handler that throws
- `request_human_input` — returns `{ type: "pause" }` to signal engine stop

Handler type is `(input) => CustomToolResult | Promise<CustomToolResult>` — both sync and async are valid.

### MCP Server Resolution

Skills/workflows reference MCP servers by name. The executor calls `buildMcpServersConfig()` to resolve names to `McpServerConfig` objects (command, args, env) from the database.

## Dependencies

- `@clawback/shared` — types (Skill, Event, Workflow, etc.)
- `@clawback/db` — repositories (EventRepository, RunRepository, etc.)
- `@anthropic-ai/sdk` — only used inside `ai/direct-engine.ts`
- `@anthropic-ai/claude-agent-sdk` — only used inside `ai/sdk-engine.ts`
- `@modelcontextprotocol/sdk` — MCP client, only used inside `ai/direct-engine.ts`
- `micromatch` — tool permission glob matching, only in `ai/direct-engine.ts`

## Testing

- Test files live alongside source: `*.test.ts`
- Mock `AiEngine` interface (not Anthropic SDK) when testing executors
- Run: `cd apps/daemon && pnpm test:run`
- Typecheck: `cd apps/daemon && pnpm typecheck`

## Known Issues

- `Event` type mismatch: DB returns `payload: string` but shared type expects `Record<string, unknown>`. This is pre-existing in api.ts, queue.ts, workflow-executor.ts, builder-executor.ts.
- `queue.ts` has unused `skillRegistry` field (pre-existing TS6138).
