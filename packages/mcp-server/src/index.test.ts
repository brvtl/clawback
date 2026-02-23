import { describe, it, expect, vi, beforeEach } from "vitest";
import { TOOLS, handleToolCall } from "./index.js";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function mockFetchSuccess(data: unknown): void {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: () => Promise.resolve(data),
  });
}

function mockFetchError(status: number, statusText: string): void {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status,
    statusText,
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("TOOLS", () => {
  it("registers all 28 tools", () => {
    expect(TOOLS).toHaveLength(28);
  });

  it("every tool has name, description, and inputSchema", () => {
    for (const tool of TOOLS) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.inputSchema).toBeDefined();
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("has no duplicate tool names", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  const expectedTools = [
    // Skills
    "list_skills",
    "get_skill",
    "create_skill",
    "update_skill",
    "delete_skill",
    "import_remote_skill",
    // Workflows
    "list_workflows",
    "get_workflow",
    "create_workflow",
    "update_workflow",
    "delete_workflow",
    "trigger_workflow",
    "list_workflow_runs",
    // Events
    "list_events",
    // Runs
    "list_runs",
    "get_run",
    // Checkpoints
    "get_checkpoints",
    // HITL
    "list_hitl_requests",
    "get_hitl_request",
    "respond_to_hitl",
    "cancel_hitl_request",
    // Scheduled Jobs
    "list_scheduled_jobs",
    "toggle_scheduled_job",
    // MCP Servers
    "list_mcp_servers",
    "create_mcp_server",
    "update_mcp_server",
    "delete_mcp_server",
    // System
    "get_status",
  ];

  it.each(expectedTools)("includes tool: %s", (toolName) => {
    expect(TOOLS.find((t) => t.name === toolName)).toBeDefined();
  });
});

describe("handleToolCall", () => {
  // ── Skills ──────────────────────────────────────────

  it("list_skills → GET /api/skills", async () => {
    mockFetchSuccess({ skills: [{ id: "s1" }] });
    const result = await handleToolCall("list_skills", {});
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/skills",
      expect.objectContaining({ headers: expect.any(Object) })
    );
    expect(result).toEqual([{ id: "s1" }]);
  });

  it("get_skill → GET /api/skills/:id", async () => {
    mockFetchSuccess({ skill: { id: "s1", name: "test" } });
    const result = await handleToolCall("get_skill", { skill_id: "s1" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/skills/s1",
      expect.any(Object)
    );
    expect(result).toEqual({ id: "s1", name: "test" });
  });

  it("create_skill → POST /api/skills", async () => {
    mockFetchSuccess({ skill: { id: "s2" } });
    const args = {
      name: "test",
      instructions: "do stuff",
      triggers: [],
    };
    await handleToolCall("create_skill", args);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/skills",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(args),
      })
    );
  });

  it("update_skill → PUT /api/skills/:id", async () => {
    mockFetchSuccess({ skill: { id: "s1", name: "updated" } });
    await handleToolCall("update_skill", {
      skill_id: "s1",
      name: "updated",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/skills/s1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ name: "updated" }),
      })
    );
  });

  it("delete_skill → DELETE /api/skills/:id", async () => {
    mockFetchSuccess({ success: true });
    await handleToolCall("delete_skill", { skill_id: "s1" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/skills/s1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("import_remote_skill → POST /api/skills/remote", async () => {
    mockFetchSuccess({
      skill: { id: "s3" },
      reviewResult: { approved: true },
    });
    await handleToolCall("import_remote_skill", {
      source_url: "https://example.com/skill.md",
      name: "imported",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/skills/remote",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          sourceUrl: "https://example.com/skill.md",
          name: "imported",
        }),
      })
    );
  });

  // ── Workflows ───────────────────────────────────────

  it("list_workflows → GET /api/workflows", async () => {
    mockFetchSuccess({ workflows: [] });
    await handleToolCall("list_workflows", {});
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/workflows",
      expect.any(Object)
    );
  });

  it("get_workflow → GET /api/workflows/:id", async () => {
    mockFetchSuccess({ workflow: { id: "w1" }, skills: [] });
    const result = await handleToolCall("get_workflow", {
      workflow_id: "w1",
    });
    expect(result).toEqual({ workflow: { id: "w1" }, skills: [] });
  });

  it("create_workflow → POST /api/workflows", async () => {
    mockFetchSuccess({ workflow: { id: "w2" } });
    await handleToolCall("create_workflow", {
      name: "wf",
      instructions: "orchestrate",
      triggers: [],
      skills: ["s1"],
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/workflows",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("update_workflow → PUT /api/workflows/:id", async () => {
    mockFetchSuccess({ workflow: { id: "w1", name: "updated" } });
    await handleToolCall("update_workflow", {
      workflow_id: "w1",
      name: "updated",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/workflows/w1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ name: "updated" }),
      })
    );
  });

  it("delete_workflow → DELETE /api/workflows/:id", async () => {
    mockFetchSuccess({ success: true });
    await handleToolCall("delete_workflow", { workflow_id: "w1" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/workflows/w1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("trigger_workflow → POST /api/workflows/:id/trigger", async () => {
    mockFetchSuccess({ workflowRun: {}, event: {} });
    await handleToolCall("trigger_workflow", {
      workflow_id: "w1",
      payload: { key: "val" },
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/workflows/w1/trigger",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ payload: { key: "val" } }),
      })
    );
  });

  it("list_workflow_runs → GET /api/workflows/:id/runs", async () => {
    mockFetchSuccess({ runs: [] });
    await handleToolCall("list_workflow_runs", { workflow_id: "w1" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/workflows/w1/runs",
      expect.any(Object)
    );
  });

  // ── Events ──────────────────────────────────────────

  it("list_events → GET /api/events?limit=N", async () => {
    mockFetchSuccess({ events: [] });
    await handleToolCall("list_events", { limit: 5 });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/events?limit=5",
      expect.any(Object)
    );
  });

  // ── Runs ────────────────────────────────────────────

  it("list_runs → GET /api/runs", async () => {
    mockFetchSuccess({ runs: [] });
    await handleToolCall("list_runs", { limit: 20, skill_id: "s1" });
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/runs?"),
      expect.any(Object)
    );
    const url = mockFetch.mock.calls[0]![0] as string;
    expect(url).toContain("limit=20");
    expect(url).toContain("skillId=s1");
  });

  it("get_run → GET /api/runs/:id", async () => {
    mockFetchSuccess({ run: { id: "r1" } });
    const result = await handleToolCall("get_run", { run_id: "r1" });
    expect(result).toEqual({ id: "r1" });
  });

  // ── Checkpoints ─────────────────────────────────────

  it("get_checkpoints (skill) → GET /api/runs/:id/checkpoints", async () => {
    mockFetchSuccess({ checkpoints: [] });
    await handleToolCall("get_checkpoints", { run_id: "r1" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/runs/r1/checkpoints",
      expect.any(Object)
    );
  });

  it("get_checkpoints (workflow) → GET /api/workflow-runs/:id/checkpoints", async () => {
    mockFetchSuccess({ checkpoints: [] });
    await handleToolCall("get_checkpoints", {
      run_id: "wr1",
      run_type: "workflow",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/workflow-runs/wr1/checkpoints",
      expect.any(Object)
    );
  });

  // ── HITL ────────────────────────────────────────────

  it("list_hitl_requests → GET /api/hitl-requests", async () => {
    mockFetchSuccess({ requests: [] });
    await handleToolCall("list_hitl_requests", {});
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/hitl-requests",
      expect.any(Object)
    );
  });

  it("get_hitl_request → GET /api/hitl-requests/:id", async () => {
    mockFetchSuccess({ request: { id: "h1" } });
    await handleToolCall("get_hitl_request", { request_id: "h1" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/hitl-requests/h1",
      expect.any(Object)
    );
  });

  it("respond_to_hitl → POST /api/hitl-requests/:id/respond", async () => {
    mockFetchSuccess({ request: {}, message: "Workflow resuming" });
    await handleToolCall("respond_to_hitl", {
      request_id: "h1",
      response: "approved",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/hitl-requests/h1/respond",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ response: "approved" }),
      })
    );
  });

  it("cancel_hitl_request → POST /api/hitl-requests/:id/cancel", async () => {
    mockFetchSuccess({ request: {}, message: "cancelled" });
    await handleToolCall("cancel_hitl_request", { request_id: "h1" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/hitl-requests/h1/cancel",
      expect.objectContaining({ method: "POST" })
    );
  });

  // ── Scheduled Jobs ──────────────────────────────────

  it("list_scheduled_jobs → GET /api/scheduled-jobs", async () => {
    mockFetchSuccess({ jobs: [] });
    await handleToolCall("list_scheduled_jobs", {});
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/scheduled-jobs",
      expect.any(Object)
    );
  });

  it("toggle_scheduled_job → PATCH /api/scheduled-jobs/:id", async () => {
    mockFetchSuccess({ job: { id: "j1", enabled: false } });
    await handleToolCall("toggle_scheduled_job", {
      job_id: "j1",
      enabled: false,
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/scheduled-jobs/j1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ enabled: false }),
      })
    );
  });

  // ── MCP Servers ─────────────────────────────────────

  it("list_mcp_servers → GET /api/mcp-servers", async () => {
    mockFetchSuccess({ servers: [] });
    await handleToolCall("list_mcp_servers", {});
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/mcp-servers",
      expect.any(Object)
    );
  });

  it("create_mcp_server → POST /api/mcp-servers", async () => {
    mockFetchSuccess({ server: { id: "m1" } });
    await handleToolCall("create_mcp_server", {
      name: "github",
      command: "npx",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/mcp-servers",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("update_mcp_server → PUT /api/mcp-servers/:id", async () => {
    mockFetchSuccess({ server: { id: "m1" } });
    await handleToolCall("update_mcp_server", {
      server_id: "m1",
      name: "updated",
    });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/mcp-servers/m1",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ name: "updated" }),
      })
    );
  });

  it("delete_mcp_server → DELETE /api/mcp-servers/:id", async () => {
    mockFetchSuccess({ success: true });
    await handleToolCall("delete_mcp_server", { server_id: "m1" });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/mcp-servers/m1",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  // ── System ──────────────────────────────────────────

  it("get_status → GET /api/status", async () => {
    mockFetchSuccess({ status: "ok", skills: 3 });
    const result = await handleToolCall("get_status", {});
    expect(result).toEqual({ status: "ok", skills: 3 });
  });

  // ── Error handling ──────────────────────────────────

  it("throws on unknown tool", async () => {
    await expect(handleToolCall("nonexistent_tool", {})).rejects.toThrow(
      "Unknown tool: nonexistent_tool"
    );
  });

  it("throws on API error", async () => {
    mockFetchError(404, "Not Found");
    await expect(handleToolCall("get_skill", { skill_id: "bad" })).rejects.toThrow(
      "API error: 404 Not Found"
    );
  });
});
