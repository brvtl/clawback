import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import * as os from "node:os";

interface McpConfig {
  mcpServers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
}

function prompt(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

export function getConfigPaths(overrides?: { platform?: string; homedir?: string }): {
  claudeDesktop: string;
  claudeCode: string;
} {
  const home = overrides?.homedir ?? os.homedir();
  const platform = overrides?.platform ?? os.platform();

  const claudeDesktop =
    platform === "darwin"
      ? path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json")
      : path.join(home, ".config", "Claude", "claude_desktop_config.json");

  const claudeCode = path.join(home, ".config", "claude", "mcp.json");

  return { claudeDesktop, claudeCode };
}

export function buildMcpEntry(apiUrl: string): McpConfig["mcpServers"] {
  return {
    clawback: {
      command: "npx",
      args: ["-y", "clawback-mcp"],
      env: { CLAWBACK_API_URL: apiUrl },
    },
  };
}

export function mergeConfig(
  existing: McpConfig,
  entry: NonNullable<McpConfig["mcpServers"]>
): { config: McpConfig; wasExisting: boolean } {
  const wasExisting = !!existing.mcpServers?.clawback;
  return {
    config: {
      ...existing,
      mcpServers: {
        ...existing.mcpServers,
        ...entry,
      },
    },
    wasExisting,
  };
}

function readConfigFile(filePath: string): McpConfig {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as McpConfig;
  } catch {
    return {};
  }
}

function writeConfigFile(filePath: string, config: McpConfig): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2) + "\n");
}

export async function runSetup(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  console.error("\n  Clawback MCP Server Setup\n");

  const paths = getConfigPaths();

  // Ask which clients to configure
  console.error("  Which client(s) to configure?");
  console.error("    1) Claude Desktop");
  console.error("    2) Claude Code");
  console.error("    3) Both");
  console.error("");

  const choice = await prompt(rl, "  Choice [1/2/3] (default: 3): ");
  const target = choice === "1" ? "desktop" : choice === "2" ? "code" : "both";

  // Ask for API URL
  const apiUrl = await prompt(rl, "  Clawback API URL (default: http://localhost:3000): ");
  const url = apiUrl || "http://localhost:3000";

  const entry = buildMcpEntry(url);
  const targets: Array<{ name: string; path: string }> = [];

  if (target === "desktop" || target === "both") {
    targets.push({ name: "Claude Desktop", path: paths.claudeDesktop });
  }
  if (target === "code" || target === "both") {
    targets.push({ name: "Claude Code", path: paths.claudeCode });
  }

  console.error("");

  for (const t of targets) {
    const existing = readConfigFile(t.path);
    const { config, wasExisting } = mergeConfig(existing, entry!);

    if (wasExisting) {
      console.error(`  ⚠ ${t.name}: Overwriting existing "clawback" entry in ${t.path}`);
    }

    writeConfigFile(t.path, config);
    console.error(`  ✓ ${t.name}: Written to ${t.path}`);
  }

  console.error(`\n  Done! Make sure the Clawback daemon is running at ${url}\n`);

  rl.close();
}
