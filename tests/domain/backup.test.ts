import { describe, it, expect } from "vitest";
import { exportAll } from "../../src/domain/backup";
import { replay } from "../../src/domain/replay";
import type { DomainEvent } from "../../src/domain/events";

const clientEvent: DomainEvent = {
  eventId: "e1", entityType: "client", entityId: "c1", fields: { name: "Rory" },
  recordedAt: "2026-03-01T00:00:00.000Z", deviceId: "dev-a", seq: 1,
};

describe("exportAll", () => {
  it("produces parseable JSON containing every entity", () => {
    const json = exportAll(replay([clientEvent]));
    const parsed = JSON.parse(json);
    expect(parsed.client).toEqual([{ id: "c1", name: "Rory" }]);
  });

  it("includes a version and an export timestamp", () => {
    const parsed = JSON.parse(exportAll(replay([])));
    expect(parsed.version).toBe(1);
    expect(parsed.exportedAt).toMatch(/Z$/);
  });

  it("includes deleted records so nothing is lost in a backup", () => {
    const json = exportAll(replay([clientEvent, { ...clientEvent, eventId: "e2", seq: 2, recordedAt: "2026-03-02T00:00:00.000Z", fields: { deleted: true } }]));
    expect(JSON.parse(json).client).toHaveLength(1);
  });

  it("exports an empty store without throwing", () => {
    expect(() => JSON.parse(exportAll(replay([])))).not.toThrow();
  });
});
