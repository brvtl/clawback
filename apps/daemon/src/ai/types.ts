import type Anthropic from "@anthropic-ai/sdk";

/**
 * Abstraction over the AI backend (direct Anthropic API vs Agent SDK).
 * Executors call engine.runLoop() — no direct SDK imports needed.
 */
export interface AiEngine {
  runLoop(config: LoopConfig, observer: LoopObserver): Promise<LoopResult>;
}

export interface LoopConfig {
  systemPrompt?: string;
  messages: Anthropic.MessageParam[];
  model: string;
  mcpServers: Record<string, McpServerConfig>;
  customTools?: CustomToolDef[];
  maxTurns?: number;
  toolPermissions?: { allow?: string[]; deny?: string[] };
}

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface CustomToolDef {
  name: string;
  description: string;
  inputSchema: Anthropic.Tool["input_schema"];
  handler: (input: Record<string, unknown>) => CustomToolResult | Promise<CustomToolResult>;
}

export type CustomToolResult =
  | { type: "result"; content: string; isError?: boolean }
  | { type: "pause"; toolUseId: string };

export interface LoopObserver {
  onText(text: string): void;
  onToolCall(toolName: string, toolInput: unknown, toolUseId: string): void;
  onToolResult(toolName: string, toolUseId: string, result: string, isError: boolean): void;
}

export interface LoopResult {
  finalText: string;
  messages: Anthropic.MessageParam[];
  paused?: boolean;
  pauseToolUseId?: string;
}
