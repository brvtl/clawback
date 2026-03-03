import { query, tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import type { AiEngine, LoopConfig, LoopObserver, LoopResult, CustomToolDef } from "./types.js";

/**
 * AiEngine implementation using the Claude Agent SDK (@anthropic-ai/claude-agent-sdk).
 * Authenticates via CLAUDE_CODE_OAUTH_TOKEN (Claude Max subscription).
 */
export class AgentSdkEngine implements AiEngine {
  async runLoop(config: LoopConfig, observer: LoopObserver): Promise<LoopResult> {
    // Build MCP server configs for SDK
    const mcpServers: Record<string, unknown> = {};

    for (const [name, serverConfig] of Object.entries(config.mcpServers)) {
      // Resolve ${VAR} placeholders
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
        env: resolvedEnv,
      };
    }

    // Build custom tools as an SDK MCP server
    let paused = false;
    let pauseToolUseId: string | undefined;
    const abortController = new AbortController();

    if (config.customTools && config.customTools.length > 0) {
      const sdkTools = config.customTools.map((ct) =>
        this.buildSdkTool(
          ct,
          () => {
            paused = true;
            abortController.abort();
          },
          (id) => {
            pauseToolUseId = id;
          }
        )
      );

      const customServer = createSdkMcpServer({
        name: "clawback-custom",
        version: "1.0.0",
        tools: sdkTools,
      });

      mcpServers["clawback-custom"] = customServer;
    }

    // Build allowed tools list from permissions
    const allowedTools: string[] = [];
    if (config.toolPermissions?.allow && config.toolPermissions.allow.length > 0) {
      allowedTools.push(...config.toolPermissions.allow);
    }
    // Add custom tool patterns if present
    if (config.customTools && config.customTools.length > 0) {
      allowedTools.push("mcp__clawback-custom__*");
    }

    // Build the initial message from config.messages
    const initialContent = this.messagesToPromptContent(config.messages);

    // Collect messages from SDK for state reconstruction
    const collectedMessages = [...config.messages];
    let finalText = "";

    try {
      const q = query({
        prompt: initialContent,
        options: {
          systemPrompt: config.systemPrompt ?? undefined,
          model: config.model,
          mcpServers: mcpServers as Record<
            string,
            { command: string; args: string[]; env?: Record<string, string> }
          >,
          permissionMode: "bypassPermissions",
          maxTurns: config.maxTurns,
          allowedTools: allowedTools.length > 0 ? allowedTools : undefined,
          abortController,
        },
      });

      for await (const message of q) {
        if (message.type === "assistant") {
          const content = message.message?.content;
          if (!content || !Array.isArray(content)) continue;

          // Process text blocks
          const textParts: string[] = [];
          for (const block of content) {
            if (block.type === "text") {
              textParts.push(block.text);
            } else if (block.type === "tool_use") {
              observer.onToolCall(block.name, block.input, block.id);
            }
          }
          if (textParts.length > 0) {
            const text = textParts.join("\n");
            finalText += text;
            observer.onText(text);
          }

          // Track assistant message for state reconstruction
          collectedMessages.push({ role: "assistant", content });
        } else if (message.type === "user") {
          const content = message.message?.content;
          if (!content || !Array.isArray(content)) continue;

          for (const block of content) {
            if (block.type === "tool_result") {
              const resultText =
                typeof block.content === "string" ? block.content : JSON.stringify(block.content);
              // Extract tool name from tool_use_id by finding it in the previous assistant message
              observer.onToolResult(
                block.tool_use_id,
                block.tool_use_id,
                resultText,
                !!block.is_error
              );
            }
          }

          // Track tool results for state reconstruction
          collectedMessages.push({ role: "user", content });
        } else if (message.type === "result") {
          if (message.subtype === "success" && message.result) {
            // Final result text — only add if not already captured
            if (!finalText.includes(message.result)) {
              finalText += message.result;
            }
          }
        }
      }
    } catch (err: unknown) {
      // AbortError from pause is expected
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
    // Build a Zod schema from JSON Schema properties for the SDK tool() helper.
    // The tool() function expects a Zod object; we create one from the JSON Schema.
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
        // Return a placeholder — abort will stop the loop
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
   * The SDK expects a string prompt or async generator; we flatten messages.
   */
  private messagesToPromptContent(messages: Array<{ role: string; content: unknown }>): string {
    const parts: string[] = [];

    for (const msg of messages) {
      if (typeof msg.content === "string") {
        parts.push(msg.content);
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          const b = block as { type?: string; text?: string; content?: string };
          if (b.type === "text" && b.text) {
            parts.push(b.text);
          } else if (b.type === "tool_result" && b.content) {
            parts.push(b.content);
          }
        }
      }
    }

    return parts.join("\n\n");
  }
}
