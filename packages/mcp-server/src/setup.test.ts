import { describe, it, expect } from "vitest";
import { getConfigPaths, buildMcpEntry, mergeConfig } from "./setup.js";

describe("getConfigPaths", () => {
  it("returns macOS paths on darwin", () => {
    const paths = getConfigPaths({
      platform: "darwin",
      homedir: "/Users/test",
    });
    expect(paths.claudeDesktop).toBe(
      "/Users/test/Library/Application Support/Claude/claude_desktop_config.json"
    );
    expect(paths.claudeCode).toBe("/Users/test/.config/claude/mcp.json");
  });

  it("returns Linux paths on linux", () => {
    const paths = getConfigPaths({
      platform: "linux",
      homedir: "/home/test",
    });
    expect(paths.claudeDesktop).toBe("/home/test/.config/Claude/claude_desktop_config.json");
    expect(paths.claudeCode).toBe("/home/test/.config/claude/mcp.json");
  });
});

describe("buildMcpEntry", () => {
  it("builds entry with default URL", () => {
    const entry = buildMcpEntry("http://localhost:3000");
    expect(entry).toEqual({
      clawback: {
        command: "npx",
        args: ["-y", "clawback-mcp"],
        env: { CLAWBACK_API_URL: "http://localhost:3000" },
      },
    });
  });

  it("builds entry with custom URL", () => {
    const entry = buildMcpEntry("https://clawback.example.com");
    expect(entry!.clawback.env).toEqual({
      CLAWBACK_API_URL: "https://clawback.example.com",
    });
  });
});

describe("mergeConfig", () => {
  it("adds to empty config", () => {
    const entry = buildMcpEntry("http://localhost:3000")!;
    const { config, wasExisting } = mergeConfig({}, entry);

    expect(wasExisting).toBe(false);
    expect(config.mcpServers?.clawback).toBeDefined();
    expect(config.mcpServers?.clawback.command).toBe("npx");
  });

  it("preserves existing servers", () => {
    const existing = {
      mcpServers: {
        github: {
          command: "npx",
          args: ["-y", "@modelcontextprotocol/server-github"],
          env: { GITHUB_TOKEN: "tok" },
        },
      },
    };
    const entry = buildMcpEntry("http://localhost:3000")!;
    const { config } = mergeConfig(existing, entry);

    expect(config.mcpServers?.github).toBeDefined();
    expect(config.mcpServers?.clawback).toBeDefined();
  });

  it("flags existing clawback entry", () => {
    const existing = {
      mcpServers: {
        clawback: {
          command: "npx",
          args: ["-y", "clawback-mcp"],
          env: { CLAWBACK_API_URL: "http://old:3000" },
        },
      },
    };
    const entry = buildMcpEntry("http://new:3000")!;
    const { config, wasExisting } = mergeConfig(existing, entry);

    expect(wasExisting).toBe(true);
    expect(config.mcpServers?.clawback.env?.CLAWBACK_API_URL).toBe("http://new:3000");
  });

  it("preserves non-mcpServers fields", () => {
    const existing = {
      mcpServers: {},
      someOtherField: "value",
    } as Record<string, unknown> as ReturnType<typeof mergeConfig>["config"];

    const entry = buildMcpEntry("http://localhost:3000")!;
    const { config } = mergeConfig(existing, entry);

    expect((config as Record<string, unknown>).someOtherField).toBe("value");
  });
});
