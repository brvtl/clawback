import { describe, it, expect } from "vitest";
import { generateId, generateEventId, generateRunId, generateNotificationId } from "./id.js";

describe("ID generation", () => {
  it("should generate unique IDs with prefix", () => {
    const id1 = generateId("test");
    const id2 = generateId("test");

    expect(id1).toMatch(/^test_[a-z0-9]+$/);
    expect(id2).toMatch(/^test_[a-z0-9]+$/);
    expect(id1).not.toBe(id2);
  });

  it("should generate event IDs", () => {
    const id = generateEventId();
    expect(id).toMatch(/^evt_[a-z0-9]+$/);
  });

  it("should generate run IDs", () => {
    const id = generateRunId();
    expect(id).toMatch(/^run_[a-z0-9]+$/);
  });

  it("should generate notification IDs", () => {
    const id = generateNotificationId();
    expect(id).toMatch(/^notif_[a-z0-9]+$/);
  });
});
