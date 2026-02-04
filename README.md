# Clawback

Event-driven Claude automation engine. Receives events → routes to skills → executes with MCP tools → notifies user.

## Features

- **Event Ingestion**: Webhooks for GitHub, Slack, and generic sources
- **Skill-Based Routing**: YAML/Markdown-defined skills with pattern matching
- **Claude Execution**: Agentic loop with MCP tool integration
- **Real-Time Notifications**: Desktop + WebSocket notifications
- **Web Dashboard**: SvelteKit UI for monitoring and management

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│   Webhooks  │────▶│  Event Queue │────▶│  Skill Router  │
└─────────────┘     └──────────────┘     └────────────────┘
                                                 │
                                                 ▼
┌─────────────┐     ┌──────────────┐     ┌────────────────┐
│ Notification│◀────│    Claude    │◀────│  MCP Servers   │
└─────────────┘     │    Executor  │     └────────────────┘
                    └──────────────┘
```

## Quick Start

### Prerequisites

- Node.js 24+ (use [asdf](https://asdf-vm.com/) with `.tool-versions`)
- pnpm 9+ (via corepack)

### Installation

```bash
# Enable corepack for pnpm
corepack enable
corepack prepare pnpm@9.0.0 --activate

# Install dependencies
pnpm install

# Initialize database
pnpm --filter @clawback/db db:push
```

### Development

```bash
# Start daemon (port 3000)
pnpm --filter @clawback/daemon dev

# Start web UI (port 5173)
pnpm --filter @clawback/web dev

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

Skills are defined in the `skills/` directory. Each skill has:

- `SKILL.md` - Instructions and frontmatter configuration
- `config.yaml` - Optional configuration overrides

### Example Skill

```markdown
---
name: GitHub PR Reviewer
description: Automatically reviews pull requests
triggers:
  - source: github
    events:
      - pull_request.opened
      - pull_request.synchronize
mcpServers:
  github:
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_PERSONAL_ACCESS_TOKEN: "${GITHUB_TOKEN}"
toolPermissions:
  allow:
    - "github:get_*"
    - "github:list_*"
    - "github:create_*_comment"
  deny:
    - "github:delete_*"
notifications:
  onComplete: true
  onError: true
---

# GitHub PR Reviewer

You are an expert code reviewer...
```

## API Endpoints

| Method | Endpoint             | Description        |
| ------ | -------------------- | ------------------ |
| POST   | `/webhook/:source`   | Receive webhooks   |
| GET    | `/api/status`        | System status      |
| GET    | `/api/skills`        | List skills        |
| GET    | `/api/events`        | List events        |
| GET    | `/api/runs`          | List runs          |
| GET    | `/api/notifications` | List notifications |

## Environment Variables

| Variable            | Default         | Description          |
| ------------------- | --------------- | -------------------- |
| `PORT`              | `3000`          | Server port          |
| `HOST`              | `0.0.0.0`       | Server host          |
| `DATABASE_URL`      | `./clawback.db` | SQLite database path |
| `SKILLS_DIR`        | `./skills`      | Skills directory     |
| `LOG_LEVEL`         | `info`          | Logging level        |
| `ANTHROPIC_API_KEY` | -               | Claude API key       |

## Project Structure

```
clawback/
├── apps/
│   ├── daemon/       # Fastify backend
│   └── web/          # SvelteKit frontend
├── packages/
│   ├── shared/       # Types, schemas, utils
│   └── db/           # Drizzle ORM, repositories
├── skills/           # User-defined skills
├── Dockerfile
└── docker-compose.yml
```

## Tech Stack

- **Backend**: TypeScript, Fastify, Drizzle ORM, SQLite
- **Frontend**: SvelteKit, Tailwind CSS
- **AI**: Anthropic Claude SDK, MCP SDK
- **Testing**: Vitest
- **Validation**: Zod

## License

MIT
