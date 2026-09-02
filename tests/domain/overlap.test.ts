import { describe, it, expect } from "vitest";
import { findOverlaps } from "../../src/domain/overlap";
import type { Shift } from "../../src/domain/entities";

const T = (h: number) => `2026-03-01T${String(h).padStart(2, "0")}:00:00.000Z`;
const shift = (id: string, from: number, to: number | null, clients: string[]): Shift => ({
  id, startAt: T(from), endAt: to === null ? null : T(to),
  participants: clients.map((clientId) => ({
    clientId, payerPartyId: `payer-${clientId}`, inAt: T(from), outAt: T(to ?? from),
    payRate: 2000, timeRule: "fullPerPayer",
  })),
  isIncident: false, reimbursementStatus: "unclaimed",
  occurredAt: T(from), recordedAt: T(from), zone: "UTC", tags: [], customFields: {},
});

describe("findOverlaps", () => {
  it("catches the same person billed twice for the same hour", () => {
    const a = shift("a", 9, 13, ["rory"]);
    const found = findOverlaps(a, [shift("b", 11, 15, ["rory"])]);
    expect(found).toHaveLength(1);
    expect(found[0].clientIds).toEqual(["rory"]);
    expect(found[0].minutes).toBe(120); // 11:00 to 13:00
  });

  it("ignores overlapping shifts with nobody in common", () => {
    // Two families running alongside each other is ordinary, not a mistake.
    const a = shift("a", 9, 13, ["rory"]);
    expect(findOverlaps(a, [shift("b", 10, 12, ["mia"])])).toEqual([]);
  });

  it("ignores shifts that share a person but never coincide", () => {
    const a = shift("a", 9, 12, ["rory"]);
    expect(findOverlaps(a, [shift("b", 13, 16, ["rory"])])).toEqual([]);
  });

  it("does not treat touching shifts as overlapping", () => {
    // Ending at 12 and starting at 12 is a handover, not a double booking.
    const a = shift("a", 9, 12, ["rory"]);
    expect(findOverlaps(a, [shift("b", 12, 15, ["rory"])])).toEqual([]);
  });

  it("never conflicts with itself", () => {
    const a = shift("a", 9, 13, ["rory"]);
    expect(findOverlaps(a, [a])).toEqual([]);
  });

  it("treats a running shift as running up to now, not forever", () => {
    const running = shift("a", 9, null, ["rory"]);
    // A shift later the same day does not clash with one still running at 10.
    expect(findOverlaps(running, [shift("b", 14, 16, ["rory"])], T(10))).toEqual([]);
    // One happening right now does.
    expect(findOverlaps(running, [shift("c", 9, 10, ["rory"])], T(10))).toHaveLength(1);
  });

  it("reports only the people actually on both", () => {
    const a = shift("a", 9, 13, ["rory", "mia"]);
    const found = findOverlaps(a, [shift("b", 10, 14, ["mia", "jonah"])]);
    expect(found[0].clientIds).toEqual(["mia"]);
  });

  it("skips deleted shifts", () => {
    const other = { ...shift("b", 10, 14, ["rory"]), deleted: true };
    expect(findOverlaps(shift("a", 9, 13, ["rory"]), [other])).toEqual([]);
  });
});
