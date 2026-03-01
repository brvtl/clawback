import { callApi } from "./types.js";

export const EVENT_TOOLS = [
  {
    name: "list_events",
    description: "List recent events received by Clawback",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of events to return (default 10)",
        },
      },
      required: [],
    },
  },
];

export async function handleEventToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "list_events": {
      const limit = (args.limit as number) || 10;
      const data = await callApi<{ events: unknown[] }>(`/api/events?limit=${limit}`);
      return data.events;
    }

    default:
      return null;
  }
}
