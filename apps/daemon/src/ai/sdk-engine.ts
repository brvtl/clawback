import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AiEngine, LoopConfig, LoopObserver, LoopResult, CustomToolDef } from "./types.js";

/**
 * AiEngine implementation using the Claude Agent SDK (@anthropic-ai/claude-agent-sdk).
 * Authenticates via CLAUDE_CODE_OAUTH_TOKEN (Claude Max subscription).
 */
export class AgentSdkEngine implements AiEngine {
  async runLoop(config: LoopConfig, observer: LoopObserver): Promise<LoopResult> {
    // Build MCP server configs — Options.mcpServers accepts Record<string, McpServerConfig>
    // which handles both stdio configs and in-process SDK server instances.
    const mcpServers: Record<string, unknown> = {};

    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      const resolvedEnv: Record<string, string> = {};
      if (serverConfig.env) {
        for (const [key, value] of Object.entries(serverConfig.env)) {
          resolvedEnv[key] = value.replace(/\$\{([^}]+)\}/g, (_match, varName: string) => {
            return process.env[varName] ?? "";
          });
        }
      }

      mcpServers[name] = {
        command: serverConfig.command,
        args: serverConfig.args,
        env: Object.keys(resolvedEnv).length > 0 ? resolvedEnv : undefined,
      };
    }

    // Build custom tools as an in-process SDK MCP server
    let paused = false;
    let pauseToolUseId: string | undefined;
    const abortController = new AbortController();

    if (config.customTools && config.customTools.length > 0) {
      const sdkTools = config.customTools.map((ct) =>
        this.buildSdkTool(
          ct,
          () => {
            paused = true;
            // q.close() in the for-await loop is the primary pause mechanism.
            // This is a safety-net fallback in case the loop hasn't yielded yet.
            setTimeout(() => {
              if (!abortController.signal.aborted) {
                console.warn("[AgentSdkEngine] Force-aborting after pause timeout");
                abortController.abort();
              }
            }, 5000);
          },
          (id) => {
            pauseToolUseId = id;
          }
        )
      );

      // createSdkMcpServer returns McpSdkServerConfigWithInstance — a non-serializable
      // in-process MCP server. The SDK handles it natively via Options.mcpServers.
      mcpServers["clawback-custom"] = createSdkMcpServer({
        name: "clawback-custom",
        version: "1.0.0",
        tools: sdkTools,
      });
    }

    // Build allowed tools list from permissions.
    // When toolPermissions is not set, pass undefined to allow all tools.
    // When set, include explicit allows plus custom tools wildcard.
    let allowedTools: string[] | undefined;
    if (config.toolPermissions?.allow && config.toolPermissions.allow.length > 0) {
      allowedTools = [...config.toolPermissions.allow];
      if (config.customTools && config.customTools.length > 0) {
        allowedTools.push("mcp__clawback-custom__*");
      }
    } else if (config.customTools && config.customTools.length > 0) {
      // No explicit permissions — allow all tools (undefined = allow-all).
      // Custom tools are accessible via the clawback-custom MCP server automatically.
      allowedTools = undefined;
    }

    // Build the initial message from config.messages
    const initialContent = this.messagesToPromptContent(config.messages);

    // Collect messages from SDK for state reconstruction
    const collectedMessages = [...config.messages];
    const toolUseIdToName = new Map<string, string>();
    let finalText = "";
    let resultHandled = false;

    try {
      // Strip env vars that interfere with the spawned claude CLI process:
      // - CLAUDECODE: prevents "cannot launch inside another session" error
      // - CLAUDE_CODE_ENTRYPOINT: same as above
      // - CLAUDE_CODE_OAUTH_TOKEN: let the CLI use its own auth from ~/.claude/.credentials.json
      //   (tokens in .env may be expired; the CLI handles refresh internally)
      const childEnv: Record<string, string | undefined> = { ...process.env };
      delete childEnv.CLAUDECODE;
      delete childEnv.CLAUDE_CODE_ENTRYPOINT;
      delete childEnv.CLAUDE_CODE_OAUTH_TOKEN;

      const q = query({
        prompt: initialContent,
        options: {
          systemPrompt: config.systemPrompt ?? undefined,
          model: config.model,
          mcpServers: mcpServers as Record<
            string,
            { command: string; args?: string[]; env?: Record<string, string> }
          >,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          maxTurns: config.maxTurns ?? 10,
          allowedTools,
          env: childEnv,
          abortController,
        },
      });

      for await (const message of q) {
        if (message.type === "assistant") {
          const content = message.message?.content;
          if (!content || !Array.isArray(content)) continue;

          const textParts: string[] = [];
          for (const block of content) {
            if (block.type === "text") {
              textParts.push(block.text);
            } else if (block.type === "tool_use") {
              toolUseIdToName.set(block.id, block.name);
              observer.onToolCall(block.name, block.input, block.id);
            }
          }
          if (textParts.length > 0) {
            const text = textParts.join("\n");
            finalText += text;
            observer.onText(text);
          }

          collectedMessages.push({ role: "assistant", content });
        } else if (message.type === "user") {
          const content = message.message?.content;
          if (!content || !Array.isArray(content)) continue;

          for (const block of content) {
            if (block.type === "tool_result") {
              const resultText =
                typeof block.content === "string" ? block.content : JSON.stringify(block.content);
              const toolName = toolUseIdToName.get(block.tool_use_id) ?? block.tool_use_id;
              observer.onToolResult(toolName, block.tool_use_id, resultText, !!block.is_error);
            }
          }

          collectedMessages.push({ role: "user", content });
        } else if (message.type === "result") {
          if (message.subtype === "success" && message.result && !resultHandled) {
            finalText += message.result;
            resultHandled = true;
          }
        }

        // Check if a custom tool signaled pause — break out of the loop
        // and close the query gracefully instead of aborting mid-flight
        if (paused) {
          q.close();
          break;
        }
      }
    } catch (err: unknown) {
      // Ignore errors after pause — the query was closed intentionally
      if (paused) {
        return {
          finalText,
          messages: collectedMessages,
          paused: true,
          pauseToolUseId,
        };
      }
      throw err;
    }

    if (paused) {
      return {
        finalText,
        messages: collectedMessages,
        paused: true,
        pauseToolUseId,
      };
    }

    return { finalText, messages: collectedMessages };
  }

  private buildSdkTool(
    ct: CustomToolDef,
    onPause: () => void,
    setPauseToolUseId: (id: string) => void
  ) {
    const properties = ct.inputSchema.properties ?? {};
    const required = new Set(Array.isArray(ct.inputSchema.required) ? ct.inputSchema.required : []);

    const zodShape: Record<string, z.ZodTypeAny> = {};
    for (const [key, prop] of Object.entries(properties)) {
      const p = prop as { type?: string; description?: string };
      let zodType: z.ZodTypeAny;

      switch (p.type) {
        case "string":
          zodType = z.string();
          break;
        case "number":
          zodType = z.number();
          break;
        case "boolean":
          zodType = z.boolean();
          break;
        case "array":
          zodType = z.array(z.any());
          break;
        case "object":
          zodType = z.record(z.string(), z.any());
          break;
        default:
          zodType = z.any();
      }

      if (p.description) {
        zodType = zodType.describe(p.description);
      }

      if (!required.has(key)) {
        zodType = zodType.optional();
      }

      zodShape[key] = zodType;
    }

    return tool(ct.name, ct.description, zodShape, async (args: Record<string, unknown>) => {
      const result = await ct.handler(args);

      if (result.type === "pause") {
        setPauseToolUseId(result.toolUseId);
        onPause();
        return {
          content: [{ type: "text" as const, text: "Pausing for human input..." }],
        };
      }

      return {
        content: [{ type: "text" as const, text: result.content }],
        isError: result.isError,
      };
    });
  }

  /**
   * Convert Anthropic MessageParam[] to a prompt string for the SDK.
   * Preserves tool call/result context so Claude understands the conversation history
   * (important for HITL resume where the SDK starts a fresh session).
   *
   * NOTE: This flattening loses role attribution and turn structure. For complex
   * workflows with many messages before HITL, context quality may degrade.
   * The DirectApiEngine preserves full structured messages and is preferred
   * for HITL-heavy workflows.
   */
  private messagesToPromptContent(messages: Array<{ role: string; content: unknown }>): string {
    if (messages.length > 10) {
      console.warn(
        `[AgentSdkEngine] Flattening ${messages.length} messages to prompt string. ` +
          `Context quality may degrade. Consider DirectApiEngine for HITL-heavy workflows.`
      );
    }

    const parts: string[] = [];

    for (const msg of messages) {
      if (typeof msg.content === "string") {
        parts.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          const b = block as {
            type?: string;
            text?: string;
            content?: string;
            name?: string;
            input?: unknown;
            tool_use_id?: string;
            is_error?: boolean;
          };
          if (b.type === "text" && b.text) {
            parts.push(b.text);
          } else if (b.type === "tool_use" && b.name) {
            parts.push(`[Previous tool call: ${b.name}(${JSON.stringify(b.input)})]`);
          } else if (b.type === "tool_result" && b.content) {
            const prefix = b.is_error ? "[Tool error]" : "[Tool result]";
            parts.push(`${prefix} ${b.content}`);
          }
        }
      }
    }

    return parts.join("\n\n");
  }
}
