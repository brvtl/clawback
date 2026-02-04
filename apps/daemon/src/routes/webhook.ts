import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { ServerContext } from "../server.js";

interface WebhookParams {
  source: string;
}

// Map of source to header names for event type extraction
const EVENT_TYPE_HEADERS: Record<string, string> = {
  github: "x-github-event",
  gitlab: "x-gitlab-event",
  slack: "x-slack-request-type",
};

export function registerWebhookRoutes(server: FastifyInstance, context: ServerContext): void {
  server.post<{ Params: WebhookParams }>(
    "/webhook/:source",
    async (request: FastifyRequest<{ Params: WebhookParams }>, reply: FastifyReply) => {
      const { source } = request.params;
      const payload = request.body as Record<string, unknown>;

      // Extract event type from headers or payload
      let eventType = "unknown";
      const headerName = EVENT_TYPE_HEADERS[source];
      if (headerName) {
        const headerValue = request.headers[headerName];
        if (typeof headerValue === "string") {
          eventType = headerValue;
        }
      }

      // For GitHub, combine event type with action
      if (source === "github" && typeof payload.action === "string") {
        eventType = `${eventType}.${payload.action}`;
      }

      // Extract metadata from headers
      const metadata: Record<string, unknown> = {
        headers: Object.fromEntries(
          Object.entries(request.headers).filter(
            ([key]) => !key.startsWith("content-") && key !== "host"
          )
        ),
      };

      // Queue the event
      const event = await context.eventQueue.enqueue({
        source,
        type: eventType,
        payload,
        metadata,
      });

      return reply.status(202).send({
        eventId: event.id,
        message: "Event queued for processing",
      });
    }
  );
}
