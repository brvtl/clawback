import { describe, it, expect } from "vitest";
import {
  KNOWN_MCP_SERVERS,
  detectMcpServerType,
  validateMcpServerEnv,
  fixMcpServerEnv,
} from "./mcp-server-registry.js";

describe("KNOWN_MCP_SERVERS", () => {
  it("contains at least 7 servers", () => {
    expect(KNOWN_MCP_SERVERS.length).toBeGreaterThanOrEqual(7);
  });

  it("each server has required fields", () => {
    for (const server of KNOWN_MCP_SERVERS) {
      expect(server.package).toBeTruthy();
      expect(server.displayName).toBeTruthy();
      expect(server.command).toBeTruthy();
      expect(server.args).toBeInstanceOf(Array);
      expect(server.requiredEnv).toBeInstanceOf(Array);
    }
  });

  it("GitHub server exists with correct package name", () => {
    const github = KNOWN_MCP_SERVERS.find(
      (s) => s.package === "@modelcontextprotocol/server-github"
    );
    expect(github).toBeDefined();
    expect(github?.displayName).toBe("GitHub");
  });

  it("Fetch server uses 'uvx' command", () => {
    const fetch = KNOWN_MCP_SERVERS.find((s) => s.package === "mcp-server-fetch");
    expect(fetch).toBeDefined();
    expect(fetch?.command).toBe("uvx");
  });
});

describe("detectMcpServerType", () => {
  it("detects GitHub from args ['-y', '@modelcontextprotocol/server-github']", () => {
    const result = detectMcpServerType(["-y", "@modelcontextprotocol/server-github"]);
    expect(result).toBeDefined();
    expect(result?.package).toBe("@modelcontextprotocol/server-github");
  });

  it("detects Slack from args ['-y', '@modelcontextprotocol/server-slack']", () => {
    const result = detectMcpServerType(["-y", "@modelcontextprotocol/server-slack"]);
    expect(result).toBeDefined();
    expect(result?.package).toBe("@modelcontextprotocol/server-slack");
  });

  it("detects Fetch from args ['mcp-server-fetch']", () => {
    const result = detectMcpServerType(["mcp-server-fetch"]);
    expect(result).toBeDefined();
    expect(result?.package).toBe("mcp-server-fetch");
  });

  it("returns undefined for unknown args", () => {
    const result = detectMcpServerType(["my-custom-server"]);
    expect(result).toBeUndefined();
  });
});

describe("validateMcpServerEnv", () => {
  const githubArgs = ["-y", "@modelcontextprotocol/server-github"];
  const slackArgs = ["-y", "@modelcontextprotocol/server-slack"];
  const filesystemArgs = ["-y", "@modelcontextprotocol/server-filesystem"];
  const unknownArgs = ["my-custom-server"];

  it("is valid for GitHub with correct env", () => {
    const result = validateMcpServerEnv(githubArgs, {
      GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_xxx",
    });
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("is invalid when GitHub uses GITHUB_TOKEN instead and suggests the correct key", () => {
    const result = validateMcpServerEnv(githubArgs, {
      GITHUB_TOKEN: "ghp_xxx",
    });
    expect(result.valid).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.suggestions["GITHUB_TOKEN"]).toBe("GITHUB_PERSONAL_ACCESS_TOKEN");
  });

  it("is invalid when GitHub uses GH_TOKEN instead and suggests the correct key", () => {
    const result = validateMcpServerEnv(githubArgs, {
      GH_TOKEN: "ghp_xxx",
    });
    expect(result.valid).toBe(false);
    expect(result.suggestions["GH_TOKEN"]).toBe("GITHUB_PERSONAL_ACCESS_TOKEN");
  });

  it("is invalid when required env is missing entirely for GitHub", () => {
    const result = validateMcpServerEnv(githubArgs, {});
    expect(result.valid).toBe(false);
    expect(result.warnings.some((w) => w.includes("GITHUB_PERSONAL_ACCESS_TOKEN"))).toBe(true);
  });

  it("is valid for Filesystem (no required env)", () => {
    const result = validateMcpServerEnv(filesystemArgs, {});
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("is valid for unknown server type", () => {
    const result = validateMcpServerEnv(unknownArgs, {});
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("is invalid for Slack with SLACK_TOKEN instead of SLACK_BOT_TOKEN", () => {
    const result = validateMcpServerEnv(slackArgs, {
      SLACK_TOKEN: "xoxb-xxx",
    });
    expect(result.valid).toBe(false);
    expect(result.suggestions["SLACK_TOKEN"]).toBe("SLACK_BOT_TOKEN");
  });

  it("is valid when an alias is present even though canonical key is missing", () => {
    // GITHUB_TOKEN is an alias for GITHUB_PERSONAL_ACCESS_TOKEN, but since the alias is
    // present the missing-required-env check should not fire an additional invalid marker
    // beyond the alias warning. However the alias warning itself marks valid=false.
    // The key behaviour here is: no *additional* "requires X" warning is emitted because
    // the alias satisfies the presence check for the required key.
    const result = validateMcpServerEnv(githubArgs, {
      GITHUB_TOKEN: "ghp_xxx",
    });
    // The alias warning fires (valid=false), but there must be no separate
    // "GitHub server requires GITHUB_PERSONAL_ACCESS_TOKEN" warning.
    const missingRequiredWarning = result.warnings.some(
      (w) => w.includes("requires") && w.includes("GITHUB_PERSONAL_ACCESS_TOKEN")
    );
    expect(missingRequiredWarning).toBe(false);
  });
});

describe("fixMcpServerEnv", () => {
  const githubArgs = ["-y", "@modelcontextprotocol/server-github"];
  const slackArgs = ["-y", "@modelcontextprotocol/server-slack"];
  const unknownArgs = ["my-custom-server"];

  it("renames GITHUB_TOKEN to GITHUB_PERSONAL_ACCESS_TOKEN", () => {
    const result = fixMcpServerEnv(githubArgs, { GITHUB_TOKEN: "ghp_xxx" });
    expect(result["GITHUB_PERSONAL_ACCESS_TOKEN"]).toBe("ghp_xxx");
    expect(result["GITHUB_TOKEN"]).toBeUndefined();
  });

  it("renames SLACK_TOKEN to SLACK_BOT_TOKEN", () => {
    const result = fixMcpServerEnv(slackArgs, { SLACK_TOKEN: "xoxb-xxx" });
    expect(result["SLACK_BOT_TOKEN"]).toBe("xoxb-xxx");
    expect(result["SLACK_TOKEN"]).toBeUndefined();
  });

  it("preserves correct keys unchanged", () => {
    const result = fixMcpServerEnv(githubArgs, {
      GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_xxx",
    });
    expect(result["GITHUB_PERSONAL_ACCESS_TOKEN"]).toBe("ghp_xxx");
  });

  it("returns env unchanged for unknown server type", () => {
    const env = { MY_CUSTOM_VAR: "value" };
    const result = fixMcpServerEnv(unknownArgs, env);
    expect(result).toEqual(env);
  });

  it("preserves values when renaming keys", () => {
    const token = "ghp_super_secret_token_12345";
    const result = fixMcpServerEnv(githubArgs, { GITHUB_TOKEN: token });
    expect(result["GITHUB_PERSONAL_ACCESS_TOKEN"]).toBe(token);
  });
});
