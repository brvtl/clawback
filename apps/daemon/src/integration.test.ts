import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "./server.js";
import type { FastifyInstance } from "fastify";

describe("Integration Tests", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await createServer({ logger: false });
  });

  afterEach(async () => {
    await server.close();
  });

  describe("Webhook to Event Flow", () => {
    it("should receive a webhook and create an event", async () => {
      // Send a webhook
      const webhookResponse = await server.inject({
        method: "POST",
        url: "/webhook/test",
        payload: {
          action: "test_action",
          data: { message: "Hello, World!" },
        },
      });

      expect(webhookResponse.statusCode).toBe(202);
      const { eventId } = JSON.parse(webhookResponse.body) as { eventId: string };
      expect(eventId).toMatch(/^evt_/);

      // Verify the event was created
      const eventResponse = await server.inject({
        method: "GET",
        url: `/api/events/${eventId}`,
      });

      expect(eventResponse.statusCode).toBe(200);
      const { event } = JSON.parse(eventResponse.body) as {
        event: { id: string; source: string; type: string; status: string };
      };
      expect(event.id).toBe(eventId);
      expect(event.source).toBe("test");
      // Event may be pending, processing, or completed depending on async processing
      expect(["pending", "processing", "completed"]).toContain(event.status);
    });

    it("should list events after webhook", async () => {
      // Send multiple webhooks
      await server.inject({
        method: "POST",
        url: "/webhook/github",
        payload: { action: "opened" },
        headers: { "x-github-event": "pull_request" },
      });

      await server.inject({
        method: "POST",
        url: "/webhook/slack",
        payload: { type: "message" },
      });

      // List events
      const listResponse = await server.inject({
        method: "GET",
        url: "/api/events",
      });

      expect(listResponse.statusCode).toBe(200);
      const { events } = JSON.parse(listResponse.body) as {
        events: Array<{ source: string }>;
      };
      expect(events.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("API Endpoints", () => {
    it("should return server status", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/status",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body) as {
        status: string;
        version: string;
        skills: number;
      };
      expect(body.status).toBe("ok");
      expect(body.version).toBeDefined();
      expect(typeof body.skills).toBe("number");
    });

    it("should return empty skills list initially", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/skills",
      });

      expect(response.statusCode).toBe(200);
      const { skills } = JSON.parse(response.body) as { skills: unknown[] };
      expect(Array.isArray(skills)).toBe(true);
    });

    it("should return 404 for non-existent event", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/events/evt_nonexistent",
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 404 for non-existent skill", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/skills/nonexistent-skill",
      });

      expect(response.statusCode).toBe(404);
    });

    it("should return 404 for non-existent run", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/runs/run_nonexistent",
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe("Notifications API", () => {
    it("should return empty notifications initially", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/notifications",
      });

      expect(response.statusCode).toBe(200);
      const { notifications, unreadCount } = JSON.parse(response.body) as {
        notifications: unknown[];
        unreadCount: number;
      };
      expect(Array.isArray(notifications)).toBe(true);
      expect(unreadCount).toBe(0);
    });

    it("should handle mark all read even with no notifications", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/api/notifications/read-all",
      });

      expect(response.statusCode).toBe(200);
      const { success } = JSON.parse(response.body) as { success: boolean };
      expect(success).toBe(true);
    });
  });

  describe("GitHub Webhook Integration", () => {
    it("should extract event type from x-github-event header", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/webhook/github",
        payload: {
          action: "opened",
          pull_request: {
            number: 42,
            title: "Test PR",
          },
        },
        headers: {
          "x-github-event": "pull_request",
          "x-github-delivery": "abc123",
        },
      });

      expect(response.statusCode).toBe(202);
      const { eventId } = JSON.parse(response.body) as { eventId: string };

      // Verify event type was extracted correctly
      const eventResponse = await server.inject({
        method: "GET",
        url: `/api/events/${eventId}`,
      });

      const { event } = JSON.parse(eventResponse.body) as {
        event: { type: string; source: string };
      };
      expect(event.type).toBe("pull_request.opened");
      expect(event.source).toBe("github");
    });
  });
});
