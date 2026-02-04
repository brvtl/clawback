import { spawn, type ChildProcess } from "child_process";
import micromatch from "micromatch";

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface ToolPermissions {
  allow: string[];
  deny: string[];
}

export interface McpServerInstance {
  config: McpServerConfig;
  process: ChildProcess | null;
  status: "stopped" | "starting" | "running" | "error";
}

export class McpManager {
  private servers: Map<string, McpServerInstance> = new Map();

  /**
   * Resolve environment variable placeholders in config.
   * Replaces ${VAR} syntax with actual env values.
   */
  resolveEnvVars(config: McpServerConfig): McpServerConfig {
    const resolvedEnv: Record<string, string> = {};

    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        resolvedEnv[key] = value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
          return process.env[varName] ?? "";
        });
      }
    }

    return {
      ...config,
      env: Object.keys(resolvedEnv).length > 0 ? resolvedEnv : undefined,
    };
  }

  /**
   * Check if a tool is allowed based on permission patterns.
   * Uses micromatch for glob-style pattern matching.
   */
  isToolAllowed(toolName: string, permissions: ToolPermissions): boolean {
    // If deny list matches, always deny
    if (permissions.deny.length > 0 && micromatch.isMatch(toolName, permissions.deny)) {
      return false;
    }

    // If allow list is empty, allow by default (only deny list applies)
    if (permissions.allow.length === 0) {
      return true;
    }

    // Otherwise, must match allow list
    return micromatch.isMatch(toolName, permissions.allow);
  }

  /**
   * Register an MCP server configuration.
   */
  registerServer(name: string, config: McpServerConfig): void {
    this.servers.set(name, {
      config: this.resolveEnvVars(config),
      process: null,
      status: "stopped",
    });
  }

  /**
   * Check if a server is registered.
   */
  hasServer(name: string): boolean {
    return this.servers.has(name);
  }

  /**
   * List all registered server names.
   */
  listServers(): string[] {
    return Array.from(this.servers.keys());
  }

  /**
   * Extract server name from tool name (e.g., "github:get_repo" -> "github").
   */
  extractServerName(toolName: string): string | null {
    const colonIndex = toolName.indexOf(":");
    if (colonIndex === -1) {
      return null;
    }
    return toolName.substring(0, colonIndex);
  }

  /**
   * Extract method name from tool name (e.g., "github:get_repo" -> "get_repo").
   */
  extractMethodName(toolName: string): string {
    const colonIndex = toolName.indexOf(":");
    if (colonIndex === -1) {
      return toolName;
    }
    return toolName.substring(colonIndex + 1);
  }

  /**
   * Start an MCP server process.
   */
  startServer(name: string): void {
    const instance = this.servers.get(name);
    if (!instance) {
      throw new Error(`Server ${name} not registered`);
    }

    if (instance.status === "running") {
      return;
    }

    instance.status = "starting";

    const { command, args, env } = instance.config;

    instance.process = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
    });

    instance.process.on("error", (err) => {
      console.error(`MCP server ${name} error:`, err);
      instance.status = "error";
    });

    instance.process.on("exit", (code) => {
      if (code !== 0) {
        console.error(`MCP server ${name} exited with code ${code}`);
        instance.status = "error";
      } else {
        instance.status = "stopped";
      }
      instance.process = null;
    });

    instance.status = "running";
  }

  /**
   * Stop an MCP server process.
   */
  async stopServer(name: string): Promise<void> {
    const instance = this.servers.get(name);
    if (!instance?.process) {
      return;
    }

    return new Promise((resolve) => {
      if (instance.process) {
        instance.process.on("exit", () => {
          instance.status = "stopped";
          instance.process = null;
          resolve();
        });
        instance.process.kill("SIGTERM");
      } else {
        resolve();
      }
    });
  }

  /**
   * Stop all running MCP servers.
   */
  async stopAll(): Promise<void> {
    const promises = Array.from(this.servers.keys()).map((name) => this.stopServer(name));
    await Promise.all(promises);
  }

  /**
   * Get server status.
   */
  getServerStatus(name: string): McpServerInstance["status"] | null {
    return this.servers.get(name)?.status ?? null;
  }
}
