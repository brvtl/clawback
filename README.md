# Clawback

Event-driven Claude automation engine. Receives webhook events, routes them to AI-powered skills and workflows, executes with MCP tools, and notifies users of results.

## Features

- **Dual-Mode AI Engine**: Pluggable execution via Anthropic API (per-token) or Claude Agent SDK (Max subscription)
- **Skills**: Single-purpose automations triggered by events, with per-skill model selection (Haiku/Sonnet/Opus)
- **Workflows**: AI-orchestrated multi-skill pipelines with parallel/sequential execution
- **Human-in-the-Loop**: Workflows can pause for human guidance and resume from checkpoints
- **AI Builder**: Describe automations in plain English, Claude generates skills and workflows
- **Event Ingestion**: Webhooks for GitHub, Slack, and custom sources, plus cron scheduling
- **Remote Skills**: Import skills from URLs with automated AI security review
- **Checkpoints**: Full state snapshots at every execution step for live UI updates and resume
- **MCP Integration**: Configure external tool providers (GitHub, filesystem, etc.) through the web UI
- **Notifications**: Real-time desktop + WebSocket notifications, configurable per-skill
- **Web Dashboard**: SvelteKit UI for monitoring, management, and automation creation

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│   Webhooks  │────▶│    Events    │────▶│ Skill/Workflow │
│   + Cron    │     │   (SQLite)   │     │     Router     │
└─────────────┘     └──────────────┘     └────────────────┘
                                                │
                   ┌────────────────────────────┴────────────────────────────┐
                   ▼                                                         ▼
            ┌────────────┐                                          ┌──────────────┐
            │   Skills   │                                          │   Workflows  │
            │ (single AI)│                                          │(orchestrator)│
            └────────────┘                                          └──────────────┘
                   │               ┌─────────────┐                         │
                   │               │  Human-in-  │◀────────────────────────┘
                   │               │  the-Loop   │         (pause/resume)
                   │               └─────────────┘
                   └────────────────────────┬───────────────────────────────┘
                                            ▼
                                   ┌────────────────┐
                                   │   AiEngine     │
                                   │ ┌────────────┐ │     ┌────────────────┐
                                   │ │ Direct API │ │◀───▶│  MCP Servers   │
                                   │ │ Agent SDK  │ │     └────────────────┘
                                   │ └────────────┘ │
                                   └────────────────┘
                                            │
                                   ┌────────────────┐
                                   │  Checkpoints   │───▶ WebSocket (live UI)
                                   │  Notifications │───▶ Desktop + DB
                                   └────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+ (use [asdf](https://asdf-vm.com/) with `.tool-versions`)
- pnpm 9+
- Anthropic API key **or** Claude Code OAuth token

### Installation

```bash
corepack enable
pnpm install

cp apps/daemon/.env.example .env.local
# Set ANTHROPIC_API_KEY (per-token) or CLAUDE_CODE_OAUTH_TOKEN (Max subscription)
```

### Development

```bash
pnpm dev          # Start daemon (port 3000)
pnpm dev:web      # Start web UI (port 5173)
pnpm test:run     # Run tests
pnpm lint         # Lint
pnpm typecheck    # Type check all packages
```

### Docker

```bash
docker compose up -d
docker compose logs -f daemon
```

## Creating Skills

### Via AI Builder (Recommended)

1. Open `http://localhost:5173/builder`
2. Describe what you want in plain English (e.g., "Review pull requests on my GitHub repo")
3. The AI builder generates the skill configuration
4. Review and save

### Via API

```bash
curl -X POST http://localhost:3000/api/skills \
  -H "Content-Type: application/json" \
  -d '{
    "name": "PR Reviewer",
    "description": "Reviews pull requests",
    "instructions": "You are a code reviewer...",
    "triggers": [{"source": "github", "events": ["pull_request.opened"]}],
    "mcpServers": ["github"],
    "toolPermissions": {"allow": ["*"], "deny": []},
    "model": "sonnet"
  }'
```

## Creating Workflows

Workflows orchestrate multiple skills using Claude as the coordinator. They can run skills in parallel, pause for human input, and resume from checkpoints.

### Via AI Builder

1. Open `http://localhost:5173/builder`
2. Describe the multi-step automation you want
3. Select which skills the workflow can orchestrate
4. Choose orchestrator model (Sonnet or Opus)

### Via API

```bash
curl -X POST http://localhost:3000/api/workflows \
  -H "Content-Type: application/json" \
  -d '{
    "name": "PR Review Pipeline",
    "description": "Comprehensive PR review workflow",
    "instructions": "Run analysis skills in parallel, then post review...",
    "triggers": [{"source": "github", "events": ["pull_request.*"]}],
    "skills": ["skill_abc123", "skill_def456"],
    "orchestratorModel": "sonnet"
  }'
```

## MCP Servers

Configure external tool providers through the web UI at Settings, or via API:

```bash
curl -X POST http://localhost:3000/api/mcp-servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "github",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": "${GITHUB_TOKEN}"}
  }'
```

Skills and workflows reference MCP servers by name:

```json
{
  "mcpServers": ["github", "filesystem"]
}
```

Environment variables support `${VAR}` placeholder syntax for secrets.

## API Endpoints

| Method | Endpoint                         | Description             |
| ------ | -------------------------------- | ----------------------- |
| POST   | `/webhook/:source`               | Receive webhooks        |
| GET    | `/api/status`                    | System status           |
| GET    | `/api/skills`                    | List skills             |
| POST   | `/api/skills`                    | Create skill            |
| GET    | `/api/skills/:id`                | Get skill               |
| PUT    | `/api/skills/:id`                | Update skill            |
| DELETE | `/api/skills/:id`                | Delete skill            |
| GET    | `/api/workflows`                 | List workflows          |
| POST   | `/api/workflows`                 | Create workflow         |
| GET    | `/api/workflows/:id`             | Get workflow            |
| GET    | `/api/events`                    | List events             |
| GET    | `/api/runs`                      | List runs               |
| GET    | `/api/runs/:id`                  | Get run with tool calls |
| GET    | `/api/notifications`             | List notifications      |
| GET    | `/api/mcp-servers`               | List MCP servers        |
| POST   | `/api/mcp-servers`               | Create MCP server       |
| GET    | `/api/scheduled-jobs`            | List scheduled jobs     |
| GET    | `/api/hitl-requests`             | List HITL requests      |
| POST   | `/api/hitl-requests/:id/respond` | Respond to HITL request |

## Environment Variables

| Variable                  | Default         | Description                              |
| ------------------------- | --------------- | ---------------------------------------- |
| `PORT`                    | `3000`          | Server port                              |
| `HOST`                    | `0.0.0.0`       | Server host                              |
| `DATABASE_URL`            | `./clawback.db` | SQLite database path                     |
| `ANTHROPIC_API_KEY`       | -               | Anthropic API key (direct API mode)      |
| `CLAUDE_CODE_OAUTH_TOKEN` | -               | Claude Code OAuth token (Agent SDK mode) |

Set **one** of `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN`. If neither is set, AI features are disabled with graceful degradation.

## Project Structure

```
clawback/
├── apps/
│   ├── daemon/          # Fastify backend, AI engine, skill/workflow executor
│   │   └── src/
│   │       ├── ai/      # AiEngine abstraction (Direct API + Agent SDK)
│   │       ├── skills/  # Skill executor, registry
│   │       ├── services/# Workflow executor, builder, scheduler, notifications
│   │       ├── routes/  # API, webhook, builder routes
│   │       └── mcp/     # MCP server process management
│   └── web/             # SvelteKit frontend + builder UI
├── packages/
│   ├── shared/          # Types, Zod schemas, MCP server registry
│   ├── db/              # Drizzle ORM, SQLite, repositories
│   └── mcp-server/      # Clawback MCP server for external tool access
├── Dockerfile
└── docker-compose.yml
```

## Tech Stack

- **Backend**: TypeScript, Fastify, Drizzle ORM, SQLite
- **Frontend**: SvelteKit, Tailwind CSS
- **AI**: Anthropic SDK + Claude Agent SDK (dual-mode)
- **Testing**: Vitest
- **Validation**: Zod

## License

[Polyform Noncommercial 1.0.0](LICENSE) - Free for personal and non-commercial use.
