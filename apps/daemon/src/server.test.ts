import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "./server.js";
import type { FastifyInstance } from "fastify";

describe("Server", () => {
  let server: FastifyInstance;

  beforeEach(async () => {
    server = await createServer({ logger: false });
  });

  afterEach(async () => {
    await server.close();
  });

  describe("GET /api/status", () => {
    it("should return server status", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/status",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe("ok");
      expect(body.version).toBeDefined();
    });
  });

  describe("POST /webhook/:source", () => {
    it("should accept a webhook and queue an event", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/webhook/test",
        payload: { action: "test", data: { foo: "bar" } },
        headers: {
          "content-type": "application/json",
        },
      });

      expect(response.statusCode).toBe(202);
      const body = JSON.parse(response.body);
      expect(body.eventId).toMatch(/^evt_/);
    });

    it("should extract event type from x-event-type header", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/webhook/github",
        payload: { action: "opened" },
        headers: {
          "content-type": "application/json",
          "x-github-event": "pull_request",
        },
      });

      expect(response.statusCode).toBe(202);
    });
  });

  describe("GET /api/events", () => {
    it("should list events", async () => {
      // First create an event
      await server.inject({
        method: "POST",
        url: "/webhook/test",
        payload: { test: true },
      });

      const response = await server.inject({
        method: "GET",
        url: "/api/events",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body.events)).toBe(true);
    });
  });

  describe("GET /api/skills", () => {
    it("should list loaded skills", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/api/skills",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(Array.isArray(body.skills)).toBe(true);
    });
  });
});
