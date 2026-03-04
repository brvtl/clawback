import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock MCP SDK before importing the module under test
const mockListTools = vi.fn();
const mockConnect = vi.fn();
const mockClose = vi.fn();

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: mockConnect,
    listTools: mockListTools,
    close: mockClose,
  })),
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: vi.fn(),
}));

// Import after mocks
import { discoverServerTools } from "./tools.js";

describe("discoverServerTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns tool names and descriptions from MCP server", async () => {
    mockConnect.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue({
      tools: [
        { name: "search_messages", description: "Search emails", inputSchema: {} },
        { name: "send_email", description: "Send an email", inputSchema: {} },
      ],
    });
    mockClose.mockResolvedValue(undefined);

    const result = await discoverServerTools("email", {
      command: "npx",
      args: ["-y", "mcp-mail-server"],
    });

    expect(result).toEqual([
      { name: "search_messages", description: "Search emails" },
      { name: "send_email", description: "Send an email" },
    ]);
  });

  it("returns tools with empty description when not provided", async () => {
    mockConnect.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue({
      tools: [{ name: "some_tool", inputSchema: {} }],
    });
    mockClose.mockResolvedValue(undefined);

    const result = await discoverServerTools("test", {
      command: "node",
      args: ["server.js"],
    });

    expect(result).toEqual([{ name: "some_tool", description: "" }]);
  });

  it("returns empty array on connection error", async () => {
    mockConnect.mockRejectedValue(new Error("Connection refused"));

    const result = await discoverServerTools("broken", {
      command: "nonexistent",
      args: [],
    });

    expect(result).toEqual([]);
  });

  it("returns empty array on listTools error", async () => {
    mockConnect.mockResolvedValue(undefined);
    mockListTools.mockRejectedValue(new Error("Protocol error"));
    mockClose.mockResolvedValue(undefined);

    const result = await discoverServerTools("broken", {
      command: "node",
      args: ["server.js"],
    });

    expect(result).toEqual([]);
  });

  it("calls close even when listTools fails", async () => {
    mockConnect.mockResolvedValue(undefined);
    mockListTools.mockRejectedValue(new Error("fail"));
    mockClose.mockResolvedValue(undefined);

    await discoverServerTools("test", { command: "node", args: [] });

    expect(mockClose).toHaveBeenCalled();
  });

  it("handles close errors gracefully", async () => {
    mockConnect.mockResolvedValue(undefined);
    mockListTools.mockResolvedValue({ tools: [] });
    mockClose.mockRejectedValue(new Error("close failed"));

    const result = await discoverServerTools("test", {
      command: "node",
      args: [],
    });

    expect(result).toEqual([]);
  });
});
