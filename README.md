# Clawback

Event-driven Claude automation engine. Receives events → routes to skills/workflows → executes with MCP tools → notifies user.

## Features

- **Event Ingestion**: Webhooks for GitHub, Slack, and generic sources
- **AI-Powered Builder**: Describe automations in plain English, Claude generates skills and workflows
- **Skills**: Single-purpose automations triggered by events
- **Workflows**: AI-orchestrated multi-skill automations using Claude (Opus/Sonnet)
- **Cron Scheduling**: Run skills on a schedule
- **Remote Skills**: Import skills from URLs with AI security review
- **MCP Server Management**: Configure and manage MCP servers through the web UI
- **Real-Time Notifications**: Desktop + WebSocket notifications
- **Web Dashboard**: SvelteKit UI for monitoring, management, and automation creation

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│   Webhooks  │────▶│  Event Queue │────▶│ Skill/Workflow │
│   + Cron    │     └──────────────┘     │     Router     │
└─────────────┘                          └────────────────┘
                                                │
                    ┌───────────────────────────┴───────────────────────────┐
                    ▼                                                       ▼
             ┌────────────┐                                          ┌────────────┐
             │   Skills   │                                          │  Workflows │
             │ (single AI)│                                          │(orchestrator)│
             └────────────┘                                          └────────────┘
                    │                                                       │
                    └───────────────────────────┬───────────────────────────┘
                                                ▼
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│ Notification│◀────│   Claude     │◀────│  MCP Servers   │
└─────────────┘     │ Anthropic API│     └────────────────┘
                    └──────────────┘
```

## Quick Start

### Prerequisites

- Node.js 20+ (use [asdf](https://asdf-vm.com/) with `.tool-versions`)
- pnpm 9+
- Anthropic API key

### Installation

```bash
# Enable corepack for pnpm
corepack enable

# Install dependencies
pnpm install

# Configure environment
cp apps/daemon/.env.example .env.local
# Edit .env.local with your ANTHROPIC_API_KEY
```

### Development

```bash
# Start daemon (port 3000)
pnpm dev

# Start web UI (port 5173) - in another terminal
pnpm dev:web

# Run tests
pnpm test:run

# Lint
pnpm lint
```

### Docker

```bash
# Build and run with Docker Compose
docker compose up -d

# View logs
docker compose logs -f daemon
```

## Creating Skills

### Via Web UI (Recommended)

1. Open the web UI at `http://localhost:5173`
2. Go to Skills → Create New Skill
3. Describe what you want in plain English (e.g., "Review pull requests on my GitHub repo")
4. The AI builder generates the skill configuration
5. Review and save

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
    "toolPermissions": {"allow": ["*"], "deny": []}
  }'
```

## Creating Workflows

Workflows orchestrate multiple skills using Claude as the coordinator.

### Via Web UI

1. Open the web UI at `http://localhost:5173`
2. Go to Workflows → Create New Workflow
3. Select which skills the workflow can use
4. Write orchestration instructions
5. Choose model (Sonnet or Opus)

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

## MCP Server Management

Configure MCP servers through the web UI at Settings → MCP Servers, or via API:

```bash
curl -X POST http://localhost:3000/api/mcp-servers \
  -H "Content-Type: application/json" \
  -d '{
    "name": "github",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {"GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..."}
  }'
```

Skills and workflows reference MCP servers by name:

```json
{
  "mcpServers": ["github", "filesystem"]
}
```

## API Endpoints

| Method | Endpoint              | Description         |
| ------ | --------------------- | ------------------- |
| POST   | `/webhook/:source`    | Receive webhooks    |
| GET    | `/api/status`         | System status       |
| GET    | `/api/skills`         | List skills         |
| POST   | `/api/skills`         | Create skill        |
| GET    | `/api/workflows`      | List workflows      |
| POST   | `/api/workflows`      | Create workflow     |
| GET    | `/api/events`         | List events         |
| GET    | `/api/runs`           | List runs           |
| GET    | `/api/notifications`  | List notifications  |
| GET    | `/api/mcp-servers`    | List MCP servers    |
| POST   | `/api/mcp-servers`    | Create MCP server   |
| GET    | `/api/scheduled-jobs` | List scheduled jobs |

## Environment Variables

| Variable            | Default         | Description                           |
| ------------------- | --------------- | ------------------------------------- |
| `PORT`              | `3000`          | Server port                           |
| `HOST`              | `0.0.0.0`       | Server host                           |
| `DATABASE_URL`      | `./clawback.db` | SQLite database path                  |
| `ANTHROPIC_API_KEY` | -               | Required for skill/workflow execution |

## Project Structure

```
clawback/
├── apps/
│   ├── daemon/       # Fastify backend + skill/workflow executor
│   └── web/          # SvelteKit frontend + builder UI
├── packages/
│   ├── shared/       # Types, schemas, MCP server registry
│   ├── db/           # Drizzle ORM, repositories
│   └── mcp-server/   # Clawback MCP server for external access
├── Dockerfile
└── docker-compose.yml
```

## Tech Stack

- **Backend**: TypeScript, Fastify, Drizzle ORM, SQLite
- **Frontend**: SvelteKit, Tailwind CSS
- **AI**: Anthropic SDK (Claude API)
- **Testing**: Vitest
- **Validation**: Zod

## License

[Polyform Noncommercial 1.0.0](LICENSE) - Free for personal and non-commercial use.
