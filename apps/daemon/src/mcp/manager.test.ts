import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { McpManager, type McpServerConfig } from "./manager.js";

describe("McpManager", () => {
  let manager: McpManager;

  beforeEach(() => {
    manager = new McpManager();
  });

  afterEach(async () => {
    await manager.stopAll();
  });

  describe("environment variable substitution", () => {
    it("should substitute ${VAR} syntax with env values", () => {
      process.env.TEST_TOKEN = "secret123";

      const config: McpServerConfig = {
        command: "npx",
        args: ["-y", "@test/server"],
        env: {
          API_TOKEN: "${TEST_TOKEN}",
          STATIC_VALUE: "unchanged",
        },
      };

      const resolved = manager.resolveEnvVars(config);

      expect(resolved.env?.API_TOKEN).toBe("secret123");
      expect(resolved.env?.STATIC_VALUE).toBe("unchanged");

      delete process.env.TEST_TOKEN;
    });

    it("should leave unset env vars as empty string", () => {
      const config: McpServerConfig = {
        command: "test",
        args: [],
        env: {
          MISSING: "${NONEXISTENT_VAR}",
        },
      };

      const resolved = manager.resolveEnvVars(config);

      expect(resolved.env?.MISSING).toBe("");
    });

    it("should handle multiple vars in one value", () => {
      process.env.HOST = "localhost";
      process.env.PORT = "8080";

      const config: McpServerConfig = {
        command: "test",
        args: [],
        env: {
          URL: "http://${HOST}:${PORT}",
        },
      };

      const resolved = manager.resolveEnvVars(config);

      expect(resolved.env?.URL).toBe("http://localhost:8080");

      delete process.env.HOST;
      delete process.env.PORT;
    });
  });

  describe("tool filtering", () => {
    it("should allow tools matching allow patterns", () => {
      const permissions = {
        allow: ["github:get_*", "github:list_*"],
        deny: [],
      };

      expect(manager.isToolAllowed("github:get_repo", permissions)).toBe(true);
      expect(manager.isToolAllowed("github:list_issues", permissions)).toBe(true);
      expect(manager.isToolAllowed("github:delete_repo", permissions)).toBe(false);
    });

    it("should deny tools matching deny patterns", () => {
      const permissions = {
        allow: ["github:*"],
        deny: ["github:delete_*", "github:merge_*"],
      };

      expect(manager.isToolAllowed("github:get_repo", permissions)).toBe(true);
      expect(manager.isToolAllowed("github:delete_repo", permissions)).toBe(false);
      expect(manager.isToolAllowed("github:merge_pr", permissions)).toBe(false);
    });

    it("should deny by default if no allow patterns match", () => {
      const permissions = {
        allow: ["slack:*"],
        deny: [],
      };

      expect(manager.isToolAllowed("github:get_repo", permissions)).toBe(false);
    });

    it("should allow all if allow is empty (default allow)", () => {
      const permissions = {
        allow: [],
        deny: ["dangerous:*"],
      };

      expect(manager.isToolAllowed("github:get_repo", permissions)).toBe(true);
      expect(manager.isToolAllowed("dangerous:destroy", permissions)).toBe(false);
    });
  });

  describe("server registry", () => {
    it("should track registered servers", () => {
      const config: McpServerConfig = {
        command: "echo",
        args: ["test"],
      };

      manager.registerServer("test-server", config);

      expect(manager.hasServer("test-server")).toBe(true);
      expect(manager.hasServer("nonexistent")).toBe(false);
    });

    it("should list registered servers", () => {
      manager.registerServer("server1", { command: "echo", args: [] });
      manager.registerServer("server2", { command: "echo", args: [] });

      const servers = manager.listServers();

      expect(servers).toContain("server1");
      expect(servers).toContain("server2");
      expect(servers.length).toBe(2);
    });
  });

  describe("tool routing", () => {
    it("should extract server name from tool name", () => {
      expect(manager.extractServerName("github:get_repo")).toBe("github");
      expect(manager.extractServerName("slack:post_message")).toBe("slack");
      expect(manager.extractServerName("simple_tool")).toBeNull();
    });

    it("should extract method name from tool name", () => {
      expect(manager.extractMethodName("github:get_repo")).toBe("get_repo");
      expect(manager.extractMethodName("simple_tool")).toBe("simple_tool");
    });
  });
});
