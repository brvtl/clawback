import { eq } from "drizzle-orm";
import { mcpServers, type DbMcpServer } from "../schema.js";
import type { DatabaseConnection } from "../connection.js";
import { encryptEnv, decryptEnv } from "../crypto.js";
import { KNOWN_MCP_SERVERS } from "@clawback/shared";

export interface McpServerConfig {
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface McpServer {
  id: string;
  name: string;
  description: string | undefined;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateMcpServerInput {
  name: string;
  description?: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface UpdateMcpServerInput {
  name?: string;
  description?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
}

function generateMcpServerId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `mcp_${timestamp}${random}`;
}

export class McpServerRepository {
  constructor(private db: DatabaseConnection) {}

  private toDomain(dbServer: DbMcpServer): McpServer {
    const encryptedEnv = JSON.parse(dbServer.env) as Record<string, string>;
    return {
      id: dbServer.id,
      name: dbServer.name,
      description: dbServer.description ?? undefined,
      command: dbServer.command,
      args: JSON.parse(dbServer.args) as string[],
      env: decryptEnv(encryptedEnv),
      enabled: dbServer.enabled,
      createdAt: dbServer.createdAt,
      updatedAt: dbServer.updatedAt,
    };
  }

  create(input: CreateMcpServerInput): McpServer {
    const id = generateMcpServerId();
    const now = Date.now();

    // Encrypt env values before storing
    const encryptedEnv = input.env ? encryptEnv(input.env) : {};

    const dbServer: typeof mcpServers.$inferInsert = {
      id,
      name: input.name,
      description: input.description,
      command: input.command,
      args: JSON.stringify(input.args ?? []),
      env: JSON.stringify(encryptedEnv),
      enabled: true,
      createdAt: now,
      updatedAt: now,
    };

    this.db.insert(mcpServers).values(dbServer).run();

    return this.toDomain({ ...dbServer, enabled: true } as DbMcpServer);
  }

  findById(id: string): McpServer | undefined {
    const result = this.db.select().from(mcpServers).where(eq(mcpServers.id, id)).get();
    return result ? this.toDomain(result) : undefined;
  }

  findByName(name: string): McpServer | undefined {
    const result = this.db.select().from(mcpServers).where(eq(mcpServers.name, name)).get();
    return result ? this.toDomain(result) : undefined;
  }

  findAll(enabledOnly = false): McpServer[] {
    let query = this.db.select().from(mcpServers);
    if (enabledOnly) {
      query = query.where(eq(mcpServers.enabled, true)) as typeof query;
    }
    const results = query.all();
    return results.map((r) => this.toDomain(r));
  }

  update(id: string, input: UpdateMcpServerInput): McpServer | undefined {
    const existing = this.db.select().from(mcpServers).where(eq(mcpServers.id, id)).get();
    if (!existing) {
      return undefined;
    }

    const updates: Partial<typeof mcpServers.$inferInsert> = {
      updatedAt: Date.now(),
    };

    if (input.name !== undefined) updates.name = input.name;
    if (input.description !== undefined) updates.description = input.description;
    if (input.command !== undefined) updates.command = input.command;
    if (input.args !== undefined) updates.args = JSON.stringify(input.args);
    if (input.env !== undefined) updates.env = JSON.stringify(encryptEnv(input.env));
    if (input.enabled !== undefined) updates.enabled = input.enabled;

    this.db.update(mcpServers).set(updates).where(eq(mcpServers.id, id)).run();

    return this.findById(id);
  }

  delete(id: string): boolean {
    const result = this.db.delete(mcpServers).where(eq(mcpServers.id, id)).run();
    return result.changes > 0;
  }

  /**
   * Seed known MCP servers from the registry if they don't already exist.
   * Called at startup so common servers are always visible in settings.
   */
  seedKnownServers(): void {
    for (const known of KNOWN_MCP_SERVERS) {
      // Use the display name lowercased as the server name (e.g., "GitHub" -> "github")
      const name = known.displayName.toLowerCase().replace(/\s+/g, "-");
      const existing = this.findByName(name);
      if (!existing) {
        this.create({
          name,
          description: `${known.displayName} integration`,
          command: known.command,
          args: known.args,
        });
      } else {
        // Update command/args if the registry changed
        this.update(existing.id, {
          command: known.command,
          args: known.args,
        });
      }
    }
  }

  /**
   * Get MCP server config ready for use (with env vars resolved)
   */
  getConfig(name: string): McpServerConfig | undefined {
    const server = this.findByName(name);
    if (!server?.enabled) {
      return undefined;
    }

    return {
      command: server.command,
      args: server.args,
      env: server.env,
    };
  }
}
