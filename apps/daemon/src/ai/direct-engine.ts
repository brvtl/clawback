import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import micromatch from "micromatch";
import type {
  AiEngine,
  LoopConfig,
  LoopObserver,
  LoopResult,
  McpServerConfig,
  CustomToolDef,
} from "./types.js";

interface McpConnection {
  client: Client;
  transport: StdioClientTransport;
  serverName: string;
}

/** Retry Anthropic API calls on rate limit (429) with exponential backoff. */
async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
  label = "API call"
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const isRateLimit =
        err instanceof Anthropic.RateLimitError ||
        (err instanceof Error && err.message.includes("429"));
      if (!isRateLimit || attempt === maxRetries) {
        throw err;
      }
      const waitMs = Math.min(15_000 * 2 ** attempt, 120_000);
      console.log(
        `[Retry] ${label} rate limited (attempt ${attempt + 1}/${maxRetries}), waiting ${Math.round(waitMs / 1000)}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw new Error("Unreachable");
}

/** Extract text from MCP tool result content. */
function extractMcpResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item: { type?: string; text?: string }) => {
        if (item.type === "text" && item.text) return item.text;
        return JSON.stringify(item);
      })
      .join("\n");
  }
  return JSON.stringify(content);
}

/** Check if a tool is allowed based on permission patterns. */
function isToolAllowed(
  toolName: string,
  permissions?: { allow?: string[]; deny?: string[] }
): boolean {
  if (!permissions) return true;

  if (
    permissions.deny &&
    permissions.deny.length > 0 &&
    micromatch.isMatch(toolName, permissions.deny)
  ) {
    return false;
  }

  if (!permissions.allow || permissions.allow.length === 0) return true;

  return micromatch.isMatch(toolName, permissions.allow);
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
 * AiEngine implementation using the direct Anthropic API (@anthropic-ai/sdk).
 * Manages MCP server connections and runs the message loop.
 */
export class DirectApiEngine implements AiEngine {
  private anthropic: Anthropic;

  constructor(apiKey: string) {
    this.anthropic = new Anthropic({ apiKey });
  }

  async runLoop(config: LoopConfig, observer: LoopObserver): Promise<LoopResult> {
    const { connections, clientMap, allTools } = await this.connectMcpServers(
      config.mcpServers,
      config.toolPermissions
    );

    // Register custom tools (for workflow orchestration)
    const customToolMap = new Map<string, CustomToolDef>();
    if (config.customTools) {
      for (const ct of config.customTools) {
        allTools.push({
          name: ct.name,
          description: ct.description,
          input_schema: ct.inputSchema,
        });
        customToolMap.set(ct.name, ct);
      }
    }

    try {
      return await this.messageLoop(config, allTools, clientMap, customToolMap, observer);
    } finally {
      await this.disconnectMcpServers(connections);
    }
  }

  private async connectMcpServers(
    mcpServers: Record<string, McpServerConfig>,
    toolPermissions?: { allow?: string[]; deny?: string[] }
  ): Promise<{
    connections: McpConnection[];
    clientMap: Map<string, Client>;
    allTools: Anthropic.Tool[];
  }> {
    const connections: McpConnection[] = [];
    const allTools: Anthropic.Tool[] = [];
    const clientMap = new Map<string, Client>();

    for (const [serverName, config] of Object.entries(mcpServers)) {
      try {
        const resolvedEnv = resolveEnvVars(config.env);
        const transport = new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: { ...process.env, ...resolvedEnv } as Record<string, string>,
        });

        const client = new Client({ name: `clawback-${serverName}`, version: "1.0.0" });
        await client.connect(transport);
        connections.push({ client, transport, serverName });
        clientMap.set(serverName, client);

        const { tools } = await client.listTools();
        for (const tool of tools) {
          const namespacedName = `mcp__${serverName}__${tool.name}`;
          if (!isToolAllowed(namespacedName, toolPermissions)) {
            continue;
          }
          allTools.push({
            name: namespacedName,
            description: tool.description ?? "",
            input_schema: tool.inputSchema as Anthropic.Tool["input_schema"],
          });
        }

        console.log(
          `[DirectApiEngine] Connected to MCP server "${serverName}" with ${tools.length} tools`
        );
      } catch (err) {
        console.warn(
          `[DirectApiEngine] Failed to connect to MCP server "${serverName}":`,
          err instanceof Error ? err.message : err
        );
      }
    }

    return { connections, clientMap, allTools };
  }

  private async messageLoop(
    config: LoopConfig,
    allTools: Anthropic.Tool[],
    clientMap: Map<string, Client>,
    customToolMap: Map<string, CustomToolDef>,
    observer: LoopObserver
  ): Promise<LoopResult> {
    let messages = [...config.messages];
    let finalText = "";
    let continueLoop = true;

    while (continueLoop) {
      const response: Anthropic.Message = await callWithRetry(
        () =>
          this.anthropic.messages.create({
            model: config.model,
            max_tokens: 4096,
            system: config.systemPrompt,
            tools: allTools.length > 0 ? allTools : undefined,
            messages,
          }),
        3,
        "DirectApiEngine"
      );

      // Process text blocks
      const textBlocks = response.content.filter(
        (block): block is Anthropic.TextBlock => block.type === "text"
      );
      if (textBlocks.length > 0) {
        const text = textBlocks.map((b) => b.text).join("\n");
        finalText += text;
        observer.onText(text);
      }

      // Check for tool use
      const toolUseBlocks = response.content.filter(
        (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
      );

      if (toolUseBlocks.length > 0) {
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUseBlocks) {
          const toolName = toolUse.name;
          const toolInput = toolUse.input as Record<string, unknown>;
          const toolId = toolUse.id;

          observer.onToolCall(toolName, toolInput, toolId);

          // Check if this is a custom tool
          const customTool = customToolMap.get(toolName);
          if (customTool) {
            const customResult = await customTool.handler(toolInput);

            if (customResult.type === "pause") {
              // HITL pause: stop loop, return messages including the current assistant response
              const pauseMessages: Anthropic.MessageParam[] = [
                ...messages,
                { role: "assistant", content: response.content },
              ];
              return {
                finalText,
                messages: pauseMessages,
                paused: true,
                pauseToolUseId: customResult.toolUseId,
              };
            }

            observer.onToolResult(
              toolName,
              toolId,
              customResult.content,
              customResult.isError ?? false
            );
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolId,
              content: customResult.content,
              is_error: customResult.isError,
            });
            continue;
          }

          // MCP tool: parse namespaced name mcp__<server>__<tool>
          const parts = toolName.split("__");
          if (parts.length < 3 || parts[0] !== "mcp") {
            const errContent = JSON.stringify({ error: `Invalid tool name format: ${toolName}` });
            observer.onToolResult(toolName, toolId, errContent, true);
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolId,
              content: errContent,
              is_error: true,
            });
            continue;
          }

          const serverName = parts[1];
          const originalToolName = parts.slice(2).join("__");
          const client = clientMap.get(serverName);

          if (!client) {
            const errContent = JSON.stringify({
              error: `MCP server "${serverName}" not connected`,
            });
            observer.onToolResult(toolName, toolId, errContent, true);
            toolResults.push({
              type: "tool_result",
              tool_use_id: toolId,
              content: errContent,
              is_error: true,
            });
            continue;
          }

          let resultContent: string;
          let isError = false;

          try {
            const mcpResult = await client.callTool({
              name: originalToolName,
              arguments: toolInput,
            });
            isError = !!mcpResult.isError;
            resultContent = extractMcpResultText(mcpResult.content);
          } catch (err) {
            isError = true;
            resultContent = JSON.stringify({
              error: err instanceof Error ? err.message : "Tool call failed",
            });
          }

          observer.onToolResult(toolName, toolId, resultContent, isError);
          toolResults.push({
            type: "tool_result",
            tool_use_id: toolId,
            content: resultContent,
            is_error: isError,
          });
        }

        messages = [
          ...messages,
          { role: "assistant", content: response.content },
          { role: "user", content: toolResults },
        ];
      } else {
        continueLoop = false;
      }

      if (response.stop_reason === "end_turn" && toolUseBlocks.length === 0) {
        continueLoop = false;
      }
    }

    return { finalText, messages };
  }

  private async disconnectMcpServers(connections: McpConnection[]): Promise<void> {
    for (const conn of connections) {
      try {
        await conn.client.close();
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
