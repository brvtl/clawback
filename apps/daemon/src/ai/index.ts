export type {
  AiEngine,
  LoopConfig,
  LoopObserver,
  LoopResult,
  McpServerConfig,
  CustomToolDef,
  CustomToolResult,
} from "./types.js";

import type { AiEngine } from "./types.js";
import { DirectApiEngine } from "./direct-engine.js";
import { AgentSdkEngine } from "./sdk-engine.js";

export function createAiEngine(): AiEngine {
  if (process.env.ANTHROPIC_API_KEY) {
    console.log("[AiEngine] Using direct Anthropic API mode");
    return new DirectApiEngine(process.env.ANTHROPIC_API_KEY);
  }

  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) {
    console.log("[AiEngine] Using Agent SDK mode (Claude Max subscription)");
    return new AgentSdkEngine();
  }

  throw new Error(
    "No AI credentials configured. Set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN."
  );
}

export { DirectApiEngine } from "./direct-engine.js";
export { AgentSdkEngine } from "./sdk-engine.js";
