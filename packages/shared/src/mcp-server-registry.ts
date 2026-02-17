/**
 * Registry of known MCP servers with their expected configuration.
 * Used to validate env vars and provide templates for common servers.
 */

export interface KnownMcpServer {
  /** NPM package or command identifier */
  package: string;
  /** Human-readable name */
  displayName: string;
  /** Default command to run the server */
  command: string;
  /** Default args */
  args: string[];
  /** Required environment variables */
  requiredEnv: string[];
  /** Optional environment variables */
  optionalEnv?: string[];
  /** Common mistakes to check for */
  envAliases?: Record<string, string>; // wrong name -> correct name
  /** Shell commands to run before first use (e.g. installing browser binaries) */
  setupCommands?: string[];
}

export const KNOWN_MCP_SERVERS: KnownMcpServer[] = [
  {
    package: "@modelcontextprotocol/server-github",
    displayName: "GitHub",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    requiredEnv: ["GITHUB_PERSONAL_ACCESS_TOKEN"],
    envAliases: {
      GITHUB_TOKEN: "GITHUB_PERSONAL_ACCESS_TOKEN",
      GH_TOKEN: "GITHUB_PERSONAL_ACCESS_TOKEN",
      GITHUB_PAT: "GITHUB_PERSONAL_ACCESS_TOKEN",
    },
  },
  {
    package: "@modelcontextprotocol/server-filesystem",
    displayName: "Filesystem",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-filesystem"],
    requiredEnv: [],
  },
  {
    package: "@modelcontextprotocol/server-slack",
    displayName: "Slack",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-slack"],
    requiredEnv: ["SLACK_BOT_TOKEN"],
    optionalEnv: ["SLACK_TEAM_ID"],
    envAliases: {
      SLACK_TOKEN: "SLACK_BOT_TOKEN",
    },
  },
  {
    package: "@modelcontextprotocol/server-postgres",
    displayName: "PostgreSQL",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-postgres"],
    requiredEnv: ["POSTGRES_CONNECTION_STRING"],
    envAliases: {
      DATABASE_URL: "POSTGRES_CONNECTION_STRING",
      POSTGRES_URL: "POSTGRES_CONNECTION_STRING",
    },
  },
  {
    package: "@modelcontextprotocol/server-sqlite",
    displayName: "SQLite",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite"],
    requiredEnv: ["SQLITE_DB_PATH"],
  },
  {
    package: "@dkvdm/onepassword-mcp-server",
    displayName: "1Password",
    command: "npx",
    args: ["-y", "@smithery/cli", "run", "@dkvdm/onepassword-mcp-server"],
    requiredEnv: ["OP_SERVICE_ACCOUNT_TOKEN"],
    envAliases: {
      ONEPASSWORD_TOKEN: "OP_SERVICE_ACCOUNT_TOKEN",
      OP_TOKEN: "OP_SERVICE_ACCOUNT_TOKEN",
      "1PASSWORD_TOKEN": "OP_SERVICE_ACCOUNT_TOKEN",
    },
  },
  {
    package: "@playwright/mcp",
    displayName: "Playwright Browser",
    command: "npx",
    args: ["-y", "@playwright/mcp@latest", "--headless"],
    requiredEnv: [],
    setupCommands: ["npx playwright install chromium"],
  },
];

/**
 * Detect which known MCP server this config matches based on args
 */
export function detectMcpServerType(args: string[]): KnownMcpServer | undefined {
  const argsStr = args.join(" ");
  return KNOWN_MCP_SERVERS.find((server) => argsStr.includes(server.package));
}

/**
 * Validate env vars for a known MCP server type
 * Returns warnings for common mistakes and missing required vars
 */
export interface EnvValidationResult {
  valid: boolean;
  warnings: string[];
  suggestions: Record<string, string>; // current key -> suggested key
}

export function validateMcpServerEnv(
  args: string[],
  env: Record<string, string>
): EnvValidationResult {
  const serverType = detectMcpServerType(args);
  const result: EnvValidationResult = {
    valid: true,
    warnings: [],
    suggestions: {},
  };

  if (!serverType) {
    return result; // Unknown server, can't validate
  }

  const envKeys = Object.keys(env);

  // Check for common mistakes (aliases)
  if (serverType.envAliases) {
    for (const [wrongKey, correctKey] of Object.entries(serverType.envAliases)) {
      if (envKeys.includes(wrongKey) && !envKeys.includes(correctKey)) {
        result.valid = false;
        result.warnings.push(
          `${serverType.displayName} server expects "${correctKey}" but found "${wrongKey}"`
        );
        result.suggestions[wrongKey] = correctKey;
      }
    }
  }

  // Check for missing required env vars
  for (const requiredKey of serverType.requiredEnv) {
    if (!envKeys.includes(requiredKey)) {
      // Check if an alias is present
      const aliasPresent = serverType.envAliases
        ? Object.entries(serverType.envAliases).some(
            ([alias, correct]) => correct === requiredKey && envKeys.includes(alias)
          )
        : false;

      if (!aliasPresent) {
        result.valid = false;
        result.warnings.push(`${serverType.displayName} server requires "${requiredKey}"`);
      }
    }
  }

  return result;
}

/**
 * Auto-fix common env var naming mistakes
 * Returns a new env object with corrected keys
 */
export function fixMcpServerEnv(
  args: string[],
  env: Record<string, string>
): Record<string, string> {
  const serverType = detectMcpServerType(args);
  if (!serverType?.envAliases) {
    return env;
  }

  const fixed: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    const correctKey = serverType.envAliases[key] ?? key;
    fixed[correctKey] = value;
  }

  return fixed;
}

/**
 * Get setup commands needed for an MCP server (e.g. browser installation for Playwright).
 * Returns empty array if no setup is needed.
 */
export function getMcpSetupCommands(args: string[]): string[] {
  const serverType = detectMcpServerType(args);
  return serverType?.setupCommands ?? [];
}
