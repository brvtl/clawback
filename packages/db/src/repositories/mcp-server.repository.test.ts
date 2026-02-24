import { describe, it, expect, beforeEach } from "vitest";
import { McpServerRepository } from "./mcp-server.repository.js";
import { createTestConnection, type DatabaseConnection } from "../connection.js";

describe("McpServerRepository", () => {
  let db: DatabaseConnection;
  let repo: McpServerRepository;

  beforeEach(() => {
    db = createTestConnection();
    repo = new McpServerRepository(db);
  });

  describe("create", () => {
    it("should create a server with a generated id starting with mcp_", () => {
      const server = repo.create({
        name: "github",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
      });

      expect(server.id).toMatch(/^mcp_/);
      expect(server.name).toBe("github");
      expect(server.command).toBe("npx");
      expect(server.args).toEqual(["-y", "@modelcontextprotocol/server-github"]);
      expect(server.enabled).toBe(true);
    });

    it("should default args to empty array and env to empty object when not provided", () => {
      const server = repo.create({
        name: "minimal",
        command: "uvx",
      });

      expect(server.args).toEqual([]);
      expect(server.env).toEqual({});
    });
  });

  describe("findById", () => {
    it("should find an existing server by id", () => {
      const created = repo.create({
        name: "github",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
      });

      const found = repo.findById(created.id);

      expect(found).toBeDefined();
      expect(found?.id).toBe(created.id);
    });

    it("should return undefined for a non-existent id", () => {
      const found = repo.findById("mcp_nonexistent");
      expect(found).toBeUndefined();
    });
  });

  describe("findByName", () => {
    it("should find a server by name", () => {
      repo.create({ name: "github", command: "npx" });

      const found = repo.findByName("github");

      expect(found).toBeDefined();
      expect(found?.name).toBe("github");
    });

    it("should return undefined for a non-existent name", () => {
      const found = repo.findByName("does-not-exist");
      expect(found).toBeUndefined();
    });
  });

  describe("findAll", () => {
    it("should return all servers", () => {
      repo.create({ name: "github", command: "npx" });
      repo.create({ name: "fetch", command: "uvx" });

      const all = repo.findAll();

      expect(all).toHaveLength(2);
    });

    it("should return only enabled servers when enabledOnly is true", () => {
      const server1 = repo.create({ name: "github", command: "npx" });
      repo.create({ name: "fetch", command: "uvx" });

      repo.update(server1.id, { enabled: false });

      const enabledOnly = repo.findAll(true);

      expect(enabledOnly).toHaveLength(1);
      expect(enabledOnly[0]?.name).toBe("fetch");
    });
  });

  describe("update", () => {
    it("should update name, command, and args correctly", () => {
      const server = repo.create({
        name: "old-name",
        command: "old-command",
        args: ["old-arg"],
      });

      const updated = repo.update(server.id, {
        name: "new-name",
        command: "new-command",
        args: ["new-arg-1", "new-arg-2"],
      });

      expect(updated?.name).toBe("new-name");
      expect(updated?.command).toBe("new-command");
      expect(updated?.args).toEqual(["new-arg-1", "new-arg-2"]);
    });

    it("should be able to disable a server", () => {
      const server = repo.create({ name: "github", command: "npx" });
      expect(server.enabled).toBe(true);

      const updated = repo.update(server.id, { enabled: false });

      expect(updated?.enabled).toBe(false);
    });

    it("should return undefined for a non-existent id", () => {
      const updated = repo.update("mcp_nonexistent", { name: "irrelevant" });
      expect(updated).toBeUndefined();
    });
  });

  describe("delete", () => {
    it("should delete an existing server and return true", () => {
      const server = repo.create({ name: "github", command: "npx" });

      const deleted = repo.delete(server.id);

      expect(deleted).toBe(true);
      expect(repo.findById(server.id)).toBeUndefined();
    });

    it("should return false for a non-existent id", () => {
      const deleted = repo.delete("mcp_nonexistent");
      expect(deleted).toBe(false);
    });
  });

  describe("env encryption roundtrip", () => {
    it("should preserve env values through encryption and decryption", () => {
      const server = repo.create({
        name: "github",
        command: "npx",
        env: { API_KEY: "secret123", ANOTHER_VAR: "another-value" },
      });

      const found = repo.findById(server.id);

      expect(found?.env.API_KEY).toBe("secret123");
      expect(found?.env.ANOTHER_VAR).toBe("another-value");
    });
  });

  describe("seedKnownServers", () => {
    it("should create entries for known servers when the db is empty", () => {
      repo.seedKnownServers();

      expect(repo.findByName("github")).toBeDefined();
      expect(repo.findByName("fetch")).toBeDefined();
      expect(repo.findByName("slack")).toBeDefined();
    });

    it("should be idempotent - calling twice does not duplicate entries", () => {
      repo.seedKnownServers();
      const countAfterFirst = repo.findAll().length;

      repo.seedKnownServers();
      const countAfterSecond = repo.findAll().length;

      expect(countAfterSecond).toBe(countAfterFirst);
    });

    it("should restore command and args from the registry if they were changed", () => {
      repo.seedKnownServers();

      const github = repo.findByName("github");
      expect(github).toBeDefined();

      repo.update(github!.id, { command: "tampered-command", args: ["tampered-arg"] });

      repo.seedKnownServers();

      const restored = repo.findByName("github");
      expect(restored?.command).toBe("npx");
      expect(restored?.args).toEqual(["-y", "@modelcontextprotocol/server-github"]);
    });
  });

  describe("getConfig", () => {
    it("should return config for an enabled server", () => {
      repo.create({
        name: "github",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        env: { GITHUB_PERSONAL_ACCESS_TOKEN: "ghp_test" },
      });

      const config = repo.getConfig("github");

      expect(config).toBeDefined();
      expect(config?.command).toBe("npx");
      expect(config?.args).toEqual(["-y", "@modelcontextprotocol/server-github"]);
      expect(config?.env.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("ghp_test");
    });

    it("should return undefined for a disabled server", () => {
      const server = repo.create({ name: "github", command: "npx" });
      repo.update(server.id, { enabled: false });

      const config = repo.getConfig("github");

      expect(config).toBeUndefined();
    });

    it("should return undefined for a non-existent name", () => {
      const config = repo.getConfig("does-not-exist");
      expect(config).toBeUndefined();
    });
  });
});
