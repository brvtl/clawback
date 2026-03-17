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
  /** Short description of what this server provides */
  description?: string;
  /** Instructions for obtaining credentials */
  credentialHelp?: string;
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
    description: "GitHub API access — repos, issues, PRs, actions",
    credentialHelp: "Create a personal access token at https://github.com/settings/tokens",
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
    description: "Slack API access — messages, channels, users",
    credentialHelp:
      "Create a Slack app at https://api.slack.com/apps and get a Bot User OAuth Token (xoxb-...)",
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
    description: "PostgreSQL database access — queries, schema inspection",
    credentialHelp: "Connection string format: postgresql://user:password@host:5432/dbname",
  },
  {
    package: "@modelcontextprotocol/server-sqlite",
    displayName: "SQLite",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-sqlite"],
    requiredEnv: ["SQLITE_DB_PATH"],
    description: "SQLite database access — queries, schema inspection",
    credentialHelp: "Provide the path to your .db file",
  },
  {
    package: "mcp-server-fetch",
    displayName: "Fetch",
    command: "uvx",
    args: ["mcp-server-fetch"],
    requiredEnv: [],
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
    description: "1Password secret management — read vault items",
    credentialHelp:
      "Create a service account at https://my.1password.com/developer/service-accounts",
  },
  {
    package: "mcp-mail-server",
    displayName: "Email (IMAP/SMTP)",
    command: "npx",
    args: ["-y", "mcp-mail-server"],
    requiredEnv: [
      "IMAP_HOST",
      "IMAP_PORT",
      "IMAP_SECURE",
      "SMTP_HOST",
      "SMTP_PORT",
      "SMTP_SECURE",
      "EMAIL_USER",
      "EMAIL_PASS",
    ],
    description:
      "Email access via IMAP/SMTP — read, send, search emails. Works with Gmail (app password), Outlook, or any IMAP provider.",
    credentialHelp:
      "For Gmail: enable 2FA, then create an app password at https://myaccount.google.com/apppasswords. Set EMAIL_USER to your Gmail address and EMAIL_PASS to the app password.",
  },
  {
    package: "dkmaker-mcp-rest-api",
    displayName: "REST API",
    command: "npx",
    args: ["-y", "dkmaker-mcp-rest-api"],
    requiredEnv: ["REST_BASE_URL"],
    optionalEnv: [
      "AUTH_BEARER",
      "AUTH_BASIC_USERNAME",
      "AUTH_BASIC_PASSWORD",
      "AUTH_APIKEY_HEADER_NAME",
      "AUTH_APIKEY_VALUE",
    ],
    description: "Generic REST API access — call any HTTP API with configurable auth",
    credentialHelp:
      "Set REST_BASE_URL to the API base URL. For auth, set AUTH_BEARER for Bearer tokens, or AUTH_BASIC_USERNAME + AUTH_BASIC_PASSWORD for Basic auth.",
    envAliases: {
      BASE_URL: "REST_BASE_URL",
      BEARER_TOKEN: "AUTH_BEARER",
    },
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
