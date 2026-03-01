import { SKILL_TOOLS, handleSkillToolCall } from "./skill-tools.js";
import { WORKFLOW_TOOLS, handleWorkflowToolCall } from "./workflow-tools.js";
import { EVENT_TOOLS, handleEventToolCall } from "./event-tools.js";
import { RUN_TOOLS, handleRunToolCall } from "./run-tools.js";
import { CHECKPOINT_TOOLS, handleCheckpointToolCall } from "./checkpoint-tools.js";
import { HITL_TOOLS, handleHitlToolCall } from "./hitl-tools.js";
import { SCHEDULE_TOOLS, handleScheduleToolCall } from "./schedule-tools.js";
import { MCP_SERVER_TOOLS, handleMcpServerToolCall } from "./mcp-server-tools.js";
import { SYSTEM_TOOLS, handleSystemToolCall } from "./system-tools.js";

export const TOOLS = [
  ...SKILL_TOOLS,
  ...WORKFLOW_TOOLS,
  ...EVENT_TOOLS,
  ...RUN_TOOLS,
  ...CHECKPOINT_TOOLS,
  ...HITL_TOOLS,
  ...SCHEDULE_TOOLS,
  ...MCP_SERVER_TOOLS,
  ...SYSTEM_TOOLS,
];

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  const result =
    (await handleSkillToolCall(name, args)) ??
    (await handleWorkflowToolCall(name, args)) ??
    (await handleEventToolCall(name, args)) ??
    (await handleRunToolCall(name, args)) ??
    (await handleCheckpointToolCall(name, args)) ??
    (await handleHitlToolCall(name, args)) ??
    (await handleScheduleToolCall(name, args)) ??
    (await handleMcpServerToolCall(name, args)) ??
    (await handleSystemToolCall(name, args));

  if (result !== null) {
    return result;
  }

  throw new Error(`Unknown tool: ${name}`);
}
