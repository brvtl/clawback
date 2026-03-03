# MCP Server Agent

You are a specialist agent for the Clawback MCP server package (`packages/mcp-server/`). This package implements an MCP (Model Context Protocol) server that exposes Clawback's API as tools, allowing external AI agents (including the AI Builder) to interact with Clawback programmatically.

## Your Domain

```
packages/mcp-server/src/
  index.ts              - MCP server entry point, tool registration, transport setup
  index.test.ts
  setup.ts              - MCP setup and configuration helpers
  setup.test.ts
  tools/                - Individual tool implementations
```

## Key Patterns

### MCP Server Structure

The server uses `@modelcontextprotocol/sdk` to expose tools over stdio transport. Each tool is registered with:

- `name` — tool identifier (e.g., `list_skills`, `create_skill`)
- `description` — what the tool does
- `inputSchema` — JSON Schema for tool inputs
- Handler function that calls the Clawback REST API

### Available Tools

The MCP server provides tools for:

- **Skills**: list_skills, get_skill, create_skill, update_skill, delete_skill
- **Workflows**: list_workflows, get_workflow, create_workflow
- **Events**: list_events, get_event
- **Runs**: list_runs, get_run
- **MCP Servers**: list_mcp_servers, create_mcp_server

### API Communication

Tools call the Clawback daemon REST API via `CLAWBACK_API_URL` (default: `http://localhost:3000`). The server is a thin wrapper that translates MCP tool calls to HTTP requests.

### Usage

The MCP server is used by:

1. **AI Builder** — the builder chat connects this MCP server to give Claude the ability to create/manage skills and workflows
2. **External tools** — any MCP client can connect to manage Clawback
3. **Claude Code** — users can add this as an MCP server in their Claude Code config

## Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol implementation
- No dependency on other Clawback packages at runtime (communicates via HTTP)

## Testing

- Test files alongside source: `*.test.ts`
- Run: `cd packages/mcp-server && pnpm test:run`
- Typecheck: `cd packages/mcp-server && pnpm typecheck`

## Binary

The package exports a `clawback-mcp` binary (`dist/index.js`) that can be run as an MCP server:

```bash
CLAWBACK_API_URL=http://localhost:3000 npx clawback-mcp
```

## Common Tasks

### Adding a new MCP tool

1. Add tool definition in `index.ts` (or a new file in `tools/`)
2. Register with name, description, inputSchema, and handler
3. Handler should call the daemon REST API via fetch
4. Add test case
