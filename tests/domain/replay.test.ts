import { describe, it, expect } from "vitest";
import { replay, live } from "../../src/domain/replay";
import type { DomainEvent } from "../../src/domain/events";

function ev(
  entityId: string,
  fields: Record<string, unknown>,
  recordedAt: string,
  deviceId = "dev-a",
  seq = 1,
): DomainEvent {
  return {
    eventId: `${deviceId}-${recordedAt}-${seq}`,
    entityType: "client",
    entityId,
    fields,
    recordedAt,
    deviceId,
    seq,
  };
}

describe("replay", () => {
  it("builds a record from its first event", () => {
    const store = replay([ev("c1", { name: "Rory" }, "2026-01-01T00:00:00.000Z")]);
    expect(store.client.get("c1")).toEqual({ id: "c1", name: "Rory" });
  });

  it("merges later events field by field", () => {
    const store = replay([
      ev("c1", { name: "Rory", colour: "blue" }, "2026-01-01T00:00:00.000Z"),
      ev("c1", { colour: "green" }, "2026-01-02T00:00:00.000Z"),
    ]);
    expect(store.client.get("c1")).toEqual({ id: "c1", name: "Rory", colour: "green" });
  });

  it("is order-independent: a shuffled stream replays identically", () => {
    const a = ev("c1", { name: "Rory" }, "2026-01-01T00:00:00.000Z");
    const b = ev("c1", { colour: "green" }, "2026-01-02T00:00:00.000Z");
    const c = ev("c1", { name: "Rory R." }, "2026-01-03T00:00:00.000Z");
    expect(replay([c, a, b]).client.get("c1")).toEqual(replay([a, b, c]).client.get("c1"));
  });

  it("lets two devices edit different fields without either losing", () => {
    const store = replay([
      ev("c1", { name: "Rory" }, "2026-01-01T00:00:00.000Z", "dev-a", 1),
      ev("c1", { colour: "green" }, "2026-01-01T00:00:01.000Z", "dev-b", 1),
      ev("c1", { allergies: "peanuts" }, "2026-01-01T00:00:02.000Z", "dev-a", 2),
    ]);
    expect(store.client.get("c1")).toEqual({
      id: "c1",
      name: "Rory",
      colour: "green",
      allergies: "peanuts",
    });
  });

  it("resolves same-field conflicts by later timestamp", () => {
    const store = replay([
      ev("c1", { colour: "green" }, "2026-01-01T00:00:05.000Z", "dev-b", 1),
      ev("c1", { colour: "blue" }, "2026-01-01T00:00:01.000Z", "dev-a", 1),
    ]);
    expect(store.client.get("c1")!.colour).toBe("green");
  });

  it("soft-deletes without destroying the record", () => {
    const store = replay([
      ev("c1", { name: "Rory" }, "2026-01-01T00:00:00.000Z"),
      ev("c1", { deleted: true }, "2026-01-02T00:00:00.000Z"),
    ]);
    expect(store.client.get("c1")!.name).toBe("Rory");
    expect(live(store, "client")).toEqual([]);
  });

  it("restores a soft-deleted record when undeleted later", () => {
    const store = replay([
      ev("c1", { name: "Rory" }, "2026-01-01T00:00:00.000Z"),
      ev("c1", { deleted: true }, "2026-01-02T00:00:00.000Z"),
      ev("c1", { deleted: false }, "2026-01-03T00:00:00.000Z"),
    ]);
    expect(live(store, "client")).toHaveLength(1);
  });

  it("returns empty maps for an empty stream", () => {
    expect(live(replay([]), "client")).toEqual([]);
  });

  it("clears a field with null rather than undefined", () => {
    const store = replay([
      ev("c1", { name: "Rory", colour: "blue" }, "2026-01-01T00:00:00.000Z"),
      ev("c1", { colour: null }, "2026-01-02T00:00:00.000Z"),
    ]);
    expect(store.client.get("c1")!.colour).toBeNull();
  });

  it("survives a JSON round-trip so events can travel between devices", () => {
    const stream = [
      ev("c1", { name: "Rory", colour: "blue" }, "2026-01-01T00:00:00.000Z"),
      ev("c1", { colour: null }, "2026-01-02T00:00:00.000Z"),
    ];
    const throughJson: DomainEvent[] = JSON.parse(JSON.stringify(stream));
    expect(replay(throughJson).client.get("c1")).toEqual(replay(stream).client.get("c1"));
    expect(replay(throughJson).client.get("c1")!.colour).toBeNull();
  });

  it("undefined does not survive JSON, which is why null is the field-clear", () => {
    const stream = [
      ev("c1", { name: "Rory", colour: "blue" }, "2026-01-01T00:00:00.000Z"),
      ev("c1", { colour: undefined }, "2026-01-02T00:00:00.000Z"),
    ];
    const throughJson: DomainEvent[] = JSON.parse(JSON.stringify(stream));
    // After JSON round-trip, the undefined field disappears, so the event
    // contributes nothing and the old value survives.
    expect(replay(throughJson).client.get("c1")!.colour).toBe("blue");
  });

  it("ignores events with unknown entityType", () => {
    const eventWithUnknownType = {
      eventId: "evt-123",
      entityType: "unknownType" as any,
      entityId: "x1",
      fields: { name: "Unknown" },
      recordedAt: "2026-01-01T00:00:00.000Z",
      deviceId: "dev-a",
      seq: 1,
    };
    const store = replay([eventWithUnknownType]);
    // Should not throw, and should not create a bucket for the unknown type
    expect(store.client.get("x1")).toBeUndefined();
  });
});
