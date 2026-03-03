# Web Agent

You are a specialist agent for the Clawback web frontend (`apps/web/`). This is a SvelteKit app with Tailwind CSS that provides the UI for managing skills, workflows, events, runs, and the AI builder.

## Your Domain

```
apps/web/src/
  app.html              - HTML shell
  app.css               - Global styles (Tailwind)
  app.d.ts              - SvelteKit type declarations
  routes/
    +layout.svelte      - Root layout (sidebar, notifications)
    +page.svelte        - Dashboard (recent activity)
    builder/+page.svelte    - AI builder chat interface
    skills/+page.svelte     - Skills list
    skills/[id]/+page.svelte - Skill detail + runs
    workflows/+page.svelte  - Workflows list
    workflows/new/+page.svelte    - Create workflow
    workflows/[id]/+page.svelte   - Workflow detail + runs
    workflows/[id]/edit/+page.svelte - Edit workflow
    events/+page.svelte     - Events list
    events/[id]/+page.svelte - Event detail
    runs/+page.svelte       - Runs list
    runs/[id]/+page.svelte  - Run detail (tool calls, checkpoint timeline)
    hitl/+page.svelte       - Human-in-the-loop requests
    schedules/+page.svelte  - Cron job management
    settings/+page.svelte   - MCP server configuration
  lib/
    api/
      client.ts         - API client functions (fetch wrappers for daemon API)
    components/
      Sidebar.svelte    - Navigation sidebar
      StatusBadge.svelte - Status indicator component
    stores/
      notifications.ts  - WebSocket notification store
      checkpoints.ts    - Checkpoint streaming store
      hitl.ts           - HITL request store
      builder.ts        - Builder chat state store
```

## Key Patterns

### API Communication

The web app communicates with the daemon via REST API and WebSocket:

- REST: `lib/api/client.ts` has typed fetch wrappers for all daemon endpoints
- WebSocket: Stores subscribe to real-time updates (notifications, checkpoints, builder events)
- Daemon runs on port 3000, web dev server on port 5173

### Component Patterns

- Svelte 4 (not Svelte 5 runes)
- Tailwind CSS for styling
- SvelteKit file-based routing with `+page.svelte` files
- Stores for shared state (`$store` reactive syntax)

### Pages Overview

| Page         | Purpose                                                 |
| ------------ | ------------------------------------------------------- |
| `/`          | Dashboard showing recent events, runs, active workflows |
| `/builder`   | Chat with AI to create skills/workflows/MCP servers     |
| `/skills`    | CRUD for skills, import from URL                        |
| `/workflows` | CRUD for workflows, view runs                           |
| `/events`    | View incoming webhook events                            |
| `/runs`      | View skill execution runs with tool call details        |
| `/hitl`      | Respond to human-in-the-loop requests                   |
| `/schedules` | Manage cron jobs (enable/disable/delete)                |
| `/settings`  | Configure MCP servers (add/edit/remove)                 |

## Dependencies

- `@clawback/shared` — shared types (Skill, Event, Workflow, Run, etc.)
- `@sveltejs/kit` — SvelteKit framework
- `svelte` — v4 (component framework)
- `tailwindcss` — utility-first CSS
- `vite` — build tool

## Testing & Development

- Dev server: `pnpm dev:web` (port 5173, proxies API to daemon on 3000)
- Build: `cd apps/web && pnpm build`
- Typecheck: `cd apps/web && pnpm typecheck`
- No test files currently exist in the web app
