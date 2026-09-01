import { describe, it, expect } from "vitest";
import { allocateTime } from "../../src/domain/timeAllocation";
import type { Participant, TimeRule } from "../../src/domain/entities";

const T = (h: number) => `2026-03-01T${String(h).padStart(2, "0")}:00:00.000Z`;

function p(clientId: string, inAt: string, outAt: string, timeRule: TimeRule = "fullPerPayer"): Participant {
  return { clientId, payerPartyId: `payer-${clientId}`, inAt, outAt, payRate: 3000, timeRule };
}

describe("allocateTime", () => {
  it("bills a single participant their full duration", () => {
    const claims = allocateTime([p("c1", T(15), T(18))]);
    expect(claims).toEqual([
      { clientId: "c1", payerPartyId: "payer-c1", minutes: 180, amount: 9000 },
    ]);
  });

  it("bills every payer the full duration when grouped (no group discount)", () => {
    const claims = allocateTime([p("c1", T(15), T(18)), p("c2", T(15), T(18))]);
    expect(claims.map((c) => c.minutes)).toEqual([180, 180]);
    expect(claims.map((c) => c.amount)).toEqual([9000, 9000]);
  });

  it("bills each payer only for the time their own client was present", () => {
    const claims = allocateTime([p("c1", T(15), T(18)), p("c2", T(16), T(17))]);
    expect(claims.find((c) => c.clientId === "c1")!.minutes).toBe(180);
    expect(claims.find((c) => c.clientId === "c2")!.minutes).toBe(60);
  });

  it("divides shared time when a participant opts into splitEvenly", () => {
    const claims = allocateTime([
      p("c1", T(15), T(18), "splitEvenly"),
      p("c2", T(16), T(17), "splitEvenly"),
    ]);
    // c1: 60 alone + 30 of the shared hour + 60 alone = 150
    expect(claims.find((c) => c.clientId === "c1")!.minutes).toBe(150);
    // c2: 30 of the shared hour
    expect(claims.find((c) => c.clientId === "c2")!.minutes).toBe(30);
  });

  it("lets rules differ per participant on the same shift", () => {
    const claims = allocateTime([
      p("c1", T(15), T(17), "fullPerPayer"),
      p("c2", T(15), T(17), "splitEvenly"),
    ]);
    expect(claims.find((c) => c.clientId === "c1")!.minutes).toBe(120);
    expect(claims.find((c) => c.clientId === "c2")!.minutes).toBe(60);
  });

  it("uses each participant's own snapshotted rate", () => {
    const a = { ...p("c1", T(15), T(16)), payRate: 2000 };
    const b = { ...p("c2", T(15), T(16)), payRate: 4000 };
    const claims = allocateTime([a, b]);
    expect(claims.find((c) => c.clientId === "c1")!.amount).toBe(2000);
    expect(claims.find((c) => c.clientId === "c2")!.amount).toBe(4000);
  });

  it("returns nothing for no participants", () => {
    expect(allocateTime([])).toEqual([]);
  });

  it("returns nothing for a participant with zero duration", () => {
    expect(allocateTime([p("c1", T(15), T(15))])).toEqual([]);
  });

  describe("handover scenarios (one out-time equals another in-time)", () => {
    it("bills each payer exactly their own duration with fullPerPayer when handover occurs", () => {
      // c1: 15:00–17:00 (120 minutes), c2: 17:00–19:00 (120 minutes)
      // No overlap, each payer owes full amount
      const claims = allocateTime([
        p("c1", T(15), T(17), "fullPerPayer"),
        p("c2", T(17), T(19), "fullPerPayer"),
      ]);
      expect(claims.find((c) => c.clientId === "c1")!.minutes).toBe(120);
      expect(claims.find((c) => c.clientId === "c1")!.amount).toBe(6000);
      expect(claims.find((c) => c.clientId === "c2")!.minutes).toBe(120);
      expect(claims.find((c) => c.clientId === "c2")!.amount).toBe(6000);
    });

    it("does not create phantom shared segments at handover with splitEvenly", () => {
      // c1: 15:00–17:00, c2: 17:00–19:00, both splitEvenly
      // They never actually overlap, so neither should be divided
      const claims = allocateTime([
        p("c1", T(15), T(17), "splitEvenly"),
        p("c2", T(17), T(19), "splitEvenly"),
      ]);
      expect(claims.find((c) => c.clientId === "c1")!.minutes).toBe(120);
      expect(claims.find((c) => c.clientId === "c1")!.amount).toBe(6000);
      expect(claims.find((c) => c.clientId === "c2")!.minutes).toBe(120);
      expect(claims.find((c) => c.clientId === "c2")!.amount).toBe(6000);
    });
  });
});
