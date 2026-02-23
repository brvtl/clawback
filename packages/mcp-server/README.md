# clawback-mcp

MCP server for [Clawback](https://github.com/brvtl/clawback) — an event-driven Claude automation engine.

Connect Claude Desktop or Claude Code to your Clawback instance to manage skills, workflows, schedules, and more through natural language.

## Quick Start

```bash
npx clawback-mcp setup
```

This walks you through configuring Claude Desktop, Claude Code, or both. It writes the MCP server entry into the appropriate config file.

## Manual Configuration

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `~/.config/Claude/claude_desktop_config.json` (Linux):

```json
{
  "mcpServers": {
    "clawback": {
      "command": "npx",
      "args": ["-y", "clawback-mcp"],
      "env": {
        "CLAWBACK_API_URL": "http://localhost:3000"
      }
    }
  }
}
```

### Claude Code

Add to `~/.config/claude/mcp.json`:

```json
{
  "mcpServers": {
    "clawback": {
      "command": "npx",
      "args": ["-y", "clawback-mcp"],
      "env": {
        "CLAWBACK_API_URL": "http://localhost:3000"
      }
    }
  }
}
```

## Environment Variables

| Variable           | Default                 | Description                |
| ------------------ | ----------------------- | -------------------------- |
| `CLAWBACK_API_URL` | `http://localhost:3000` | URL of the Clawback daemon |

## Available Tools

### Skills

| Tool                  | Description                                         |
| --------------------- | --------------------------------------------------- |
| `list_skills`         | List all configured skills                          |
| `get_skill`           | Get skill details by ID                             |
| `create_skill`        | Create a new skill                                  |
| `update_skill`        | Update an existing skill                            |
| `delete_skill`        | Delete a skill                                      |
| `import_remote_skill` | Import a skill from a URL (with AI security review) |

### Workflows

| Tool                 | Description                                |
| -------------------- | ------------------------------------------ |
| `list_workflows`     | List all workflows                         |
| `get_workflow`       | Get workflow details and associated skills |
| `create_workflow`    | Create a new workflow                      |
| `update_workflow`    | Update an existing workflow                |
| `delete_workflow`    | Delete a workflow                          |
| `trigger_workflow`   | Manually trigger a workflow                |
| `list_workflow_runs` | List runs for a workflow                   |

### Events & Runs

| Tool              | Description                         |
| ----------------- | ----------------------------------- |
| `list_events`     | List recent incoming events         |
| `list_runs`       | List skill execution runs           |
| `get_run`         | Get run details with tool calls     |
| `get_checkpoints` | Get execution checkpoints for a run |

### Human-in-the-Loop

| Tool                  | Description                            |
| --------------------- | -------------------------------------- |
| `list_hitl_requests`  | List pending human input requests      |
| `get_hitl_request`    | Get HITL request details               |
| `respond_to_hitl`     | Submit a response to resume a workflow |
| `cancel_hitl_request` | Cancel a request (fails the workflow)  |

### Scheduled Jobs

| Tool                   | Description                       |
| ---------------------- | --------------------------------- |
| `list_scheduled_jobs`  | List all cron-scheduled jobs      |
| `toggle_scheduled_job` | Enable or disable a scheduled job |

### MCP Servers

| Tool                | Description                 |
| ------------------- | --------------------------- |
| `list_mcp_servers`  | List configured MCP servers |
| `create_mcp_server` | Add a new MCP server        |
| `update_mcp_server` | Update an MCP server config |
| `delete_mcp_server` | Remove an MCP server        |

### System

| Tool         | Description                  |
| ------------ | ---------------------------- |
| `get_status` | Get daemon status and uptime |

## Prerequisites

The Clawback daemon must be running and accessible at `CLAWBACK_API_URL`. See the [main repository](https://github.com/brvtl/clawback) for setup instructions.

## License

MIT
