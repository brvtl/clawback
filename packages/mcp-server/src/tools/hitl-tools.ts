import { callApi } from "./types.js";

export const HITL_TOOLS = [
  {
    name: "list_hitl_requests",
    description:
      "List pending human-in-the-loop requests. These are paused workflows waiting for human input.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "get_hitl_request",
    description:
      "Get details of a specific HITL request including the prompt, context, and options",
    inputSchema: {
      type: "object" as const,
      properties: {
        request_id: {
          type: "string",
          description: "The HITL request ID",
        },
      },
      required: ["request_id"],
    },
  },
  {
    name: "respond_to_hitl",
    description: "Submit a human response to a HITL request, resuming the paused workflow",
    inputSchema: {
      type: "object" as const,
      properties: {
        request_id: {
          type: "string",
          description: "The HITL request ID to respond to",
        },
        response: {
          type: "string",
          description: "The human response text",
        },
      },
      required: ["request_id", "response"],
    },
  },
  {
    name: "cancel_hitl_request",
    description: "Cancel a pending HITL request, which will fail the associated workflow",
    inputSchema: {
      type: "object" as const,
      properties: {
        request_id: {
          type: "string",
          description: "The HITL request ID to cancel",
        },
      },
      required: ["request_id"],
    },
  },
];

export async function handleHitlToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "list_hitl_requests": {
      const data = await callApi<{ requests: unknown[] }>("/api/hitl-requests");
      return data.requests;
    }

    case "get_hitl_request": {
      const requestId = args.request_id as string;
      const data = await callApi<{ request: unknown }>(`/api/hitl-requests/${requestId}`);
      return data.request;
    }

    case "respond_to_hitl": {
      const requestId = args.request_id as string;
      const response = args.response as string;
      const data = await callApi<{ request: unknown; message: string }>(
        `/api/hitl-requests/${requestId}/respond`,
        {
          method: "POST",
          body: JSON.stringify({ response }),
        }
      );
      return data;
    }

    case "cancel_hitl_request": {
      const requestId = args.request_id as string;
      const data = await callApi<{ request: unknown; message: string }>(
        `/api/hitl-requests/${requestId}/cancel`,
        { method: "POST" }
      );
      return data;
    }

    default:
      return null;
  }
}
