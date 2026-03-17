import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export interface McpToolInfo {
  name: string;
  description: string;
}

/** Resolve ${VAR} placeholders in env vars. */
function resolveEnvVars(env?: Record<string, string>): Record<string, string> {
  if (!env) return {};
  const resolved: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    resolved[key] = value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
      return process.env[varName] ?? "";
    });
  }
  return resolved;
}

/**
 * Connect to an MCP server, list its tools, and disconnect.
 * Returns tool info (not namespaced — caller adds mcp__<server>__ prefix).
 * Returns [] on any connection/listing error.
 */
export async function discoverServerTools(
  serverName: string,
  config: { command: string; args: string[]; env?: Record<string, string> }
): Promise<McpToolInfo[]> {
  let client: Client | undefined;
  let transport: StdioClientTransport | undefined;

  try {
    const resolvedEnv = resolveEnvVars(config.env);
    transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      env: { ...process.env, ...resolvedEnv } as Record<string, string>,
    });

    client = new Client({ name: `clawback-discover-${serverName}`, version: "1.0.0" });
    await client.connect(transport);

    const { tools } = await client.listTools();
    return tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
    }));
  } catch (err) {
    console.warn(
      `[ToolDiscovery] Failed to discover tools for "${serverName}":`,
      err instanceof Error ? err.message : err
    );
    return [];
  } finally {
    if (client) {
      try {
        await client.close();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
