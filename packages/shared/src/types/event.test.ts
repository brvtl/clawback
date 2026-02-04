import { describe, it, expect } from "vitest";
import { EventSchema, type Event } from "./event.js";

describe("Event", () => {
  it("should validate a valid event", () => {
    const event: Event = {
      id: "evt_123",
      source: "github",
      type: "pull_request.opened",
      payload: { action: "opened", number: 1 },
      metadata: { delivery_id: "abc123" },
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = EventSchema.safeParse(event);
    expect(result.success).toBe(true);
  });

  it("should reject an event without required fields", () => {
    const invalid = {
      id: "evt_123",
      // missing source, type, payload
    };

    const result = EventSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it("should default status to pending", () => {
    const event = {
      id: "evt_123",
      source: "github",
      type: "push",
      payload: {},
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const result = EventSchema.parse(event);
    expect(result.status).toBe("pending");
  });
});
