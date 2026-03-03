import { callApi } from "./types.js";

export const SYSTEM_TOOLS = [
  {
    name: "get_status",
    description: "Get Clawback system status including uptime and skill count",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

export async function handleSystemToolCall(
  name: string,
  _args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "get_status": {
      return await callApi<unknown>("/api/status");
    }

    default:
      return null;
  }
}
