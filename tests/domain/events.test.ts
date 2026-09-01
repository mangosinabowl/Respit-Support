import { describe, it, expect } from "vitest";
import { makeEvent, compareEvents, type DomainEvent } from "../../src/domain/events";

describe("events", () => {
  it("stamps an event with a recordedAt and a unique id", () => {
    const e = makeEvent("client", "c1", { name: "Rory" }, "dev-a", 1);
    expect(e.entityType).toBe("client");
    expect(e.entityId).toBe("c1");
    expect(e.fields).toEqual({ name: "Rory" });
    expect(e.deviceId).toBe("dev-a");
    expect(e.seq).toBe(1);
    expect(e.recordedAt).toMatch(/Z$/);
    expect(e.eventId.length).toBeGreaterThan(20);
  });

  it("orders by recordedAt first", () => {
    const early = { recordedAt: "2026-01-01T00:00:00.000Z", deviceId: "b", seq: 9 } as DomainEvent;
    const late = { recordedAt: "2026-01-02T00:00:00.000Z", deviceId: "a", seq: 1 } as DomainEvent;
    expect(compareEvents(early, late)).toBeLessThan(0);
  });

  it("breaks ties deterministically by deviceId then seq", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const a1 = { recordedAt: at, deviceId: "dev-a", seq: 1 } as DomainEvent;
    const a2 = { recordedAt: at, deviceId: "dev-a", seq: 2 } as DomainEvent;
    const b1 = { recordedAt: at, deviceId: "dev-b", seq: 1 } as DomainEvent;
    expect(compareEvents(a1, a2)).toBeLessThan(0);
    expect(compareEvents(a1, b1)).toBeLessThan(0);
    expect(compareEvents(b1, a1)).toBeGreaterThan(0);
  });

  it("sorts a shuffled stream into a stable total order", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const evs = [
      { recordedAt: at, deviceId: "dev-b", seq: 1 },
      { recordedAt: at, deviceId: "dev-a", seq: 2 },
      { recordedAt: at, deviceId: "dev-a", seq: 1 },
    ] as DomainEvent[];
    const sorted = [...evs].sort(compareEvents).map((e) => `${e.deviceId}:${e.seq}`);
    expect(sorted).toEqual(["dev-a:1", "dev-a:2", "dev-b:1"]);
  });
});
