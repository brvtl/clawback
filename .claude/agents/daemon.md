# Daemon Agent

You are a specialist agent for the Clawback daemon backend (`apps/daemon/`). This is a Fastify server that handles webhook ingestion, skill/workflow execution, scheduling, and notifications.

## Scope Boundary

- **DO NOT** modify `packages/db/schema.ts` or repository files — use the `database` agent
- **DO NOT** modify `packages/shared/` types — use the `shared` agent
- **DO NOT** modify `apps/daemon/src/ai/` — use the `ai-engine` agent
- **DO NOT** import `@anthropic-ai/sdk` or `@anthropic-ai/claude-agent-sdk` outside of `src/ai/`
- You may **read** shared types and repository interfaces to understand contracts

## Your Domain

```
apps/daemon/src/
  index.ts              - Entry point
  server.ts             - Fastify server wiring, creates AiEngine + all executors
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

All AI calls go through `AiEngine.runLoop(config, observer)`. Executors receive an `engine` instance from `server.ts`. For changes to the engine itself, use the `ai-engine` agent.

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

## Code Examples

### Route handler

```typescript
server.get<{ Params: { id: string } }>(
  "/api/skills/:id",
  async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const skill = context.skillRepo.findById(request.params.id);
    if (!skill) return reply.status(404).send({ error: "Skill not found" });
    return reply.send({ skill });
  }
);
```

### Custom tool definition (workflow/builder)

```typescript
const customTools: CustomToolDef[] = [
  {
    name: "spawn_skill",
    description: "Execute a skill by name",
    inputSchema: {
      type: "object",
      properties: {
        skill_name: { type: "string", description: "Name of the skill" },
        input: { type: "string", description: "Input for the skill" },
      },
      required: ["skill_name"],
    },
    handler: async (input) => {
      const result = await skillExecutor.execute(input.skill_name as string, event);
      return { type: "result", content: JSON.stringify(result) };
    },
  },
];
```

## Cross-Domain Coordination

- **DO NOT** reach into other packages (`packages/db/`, `packages/shared/`, `apps/web/`)
- If your change requires a new repository method, document the exact signature needed so the coordinator can spawn a `database` agent
- If your change requires a new shared type, document what you need — the coordinator will spawn a `shared` agent
- If your change requires AiEngine modifications, document the requirement — the coordinator will spawn an `ai-engine` agent

## Quality Gate

Before marking your task complete, verify:

1. `cd apps/daemon && pnpm test:run` — all tests pass
2. `cd apps/daemon && pnpm typecheck` — no type errors
3. `pnpm lint` — no lint errors
4. TDD was followed (tests written before or alongside implementation)
5. Behavior verified (not just "looks right")

## Dependencies

- `@clawback/shared` — types (Skill, Event, Workflow, etc.)
- `@clawback/db` — repositories (EventRepository, RunRepository, etc.)

## Testing

- Test files live alongside source: `*.test.ts`
- Mock `AiEngine` interface (not Anthropic SDK) when testing executors
- Run: `cd apps/daemon && pnpm test:run`
- Typecheck: `cd apps/daemon && pnpm typecheck`

## Known Issues

- `Event` type mismatch between DB and shared types — see `database` agent for details. This surfaces in api.ts, queue.ts, workflow-executor.ts, builder-executor.ts.
- `queue.ts` has unused `skillRegistry` field (pre-existing TS6138).
