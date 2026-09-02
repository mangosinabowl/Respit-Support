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
    // The lone splitter owes the whole stretch: there is no other splitter to
    // share it with. A full payer in the room does not reduce their bill.
    expect(claims.find((c) => c.clientId === "c2")!.minutes).toBe(120);
  });

  it("splits only among the splitters, ignoring full payers in the divisor", () => {
    const claims = allocateTime([
      p("c1", T(15), T(17), "fullPerPayer"),
      p("c2", T(15), T(17), "splitEvenly"),
      p("c3", T(15), T(17), "splitEvenly"),
    ]);
    expect(claims.find((c) => c.clientId === "c1")!.minutes).toBe(120);
    // Two splitters halve it between themselves. Were the full payer counted in
    // the divisor they would get 40 minutes each instead of 60.
    expect(claims.find((c) => c.clientId === "c2")!.minutes).toBe(60);
    expect(claims.find((c) => c.clientId === "c3")!.minutes).toBe(60);
  });

  it("a splitter arriving partway shares only the stretch they were there for", () => {
    const claims = allocateTime([
      p("c1", T(15), T(17), "splitEvenly"),
      p("c2", T(16), T(17), "splitEvenly"),
    ]);
    // 15-16 alone: 60 to c1. 16-17 shared: 30 each.
    expect(claims.find((c) => c.clientId === "c1")!.minutes).toBe(90);
    expect(claims.find((c) => c.clientId === "c2")!.minutes).toBe(30);
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

  describe("returning client (same child leaves and comes back)", () => {
    it("accumulates time across multiple stays with fullPerPayer and emits one claim per client", () => {
      // c1 is present 15:00–16:00 (60 min), then again 17:00–18:00 (60 min)
      // Total: 120 minutes for payer-c1, should emit exactly ONE claim
      const claims = allocateTime([
        p("c1", T(15), T(16), "fullPerPayer"),
        p("c1", T(17), T(18), "fullPerPayer"),
      ]);
      // Exactly one claim for c1
      expect(claims.filter((c) => c.clientId === "c1")).toHaveLength(1);
      expect(claims.find((c) => c.clientId === "c1")!.minutes).toBe(120);
      expect(claims.find((c) => c.clientId === "c1")!.amount).toBe(6000);
    });

    it("handles a returning client mixed with a different client present throughout", () => {
      // c1: 15:00–16:00 (60 min), then 17:00–18:00 (60 min) = 120 min total
      // c2: 15:00–18:00 (180 min) throughout
      const claims = allocateTime([
        p("c1", T(15), T(16), "fullPerPayer"),
        p("c2", T(15), T(18), "fullPerPayer"),
        p("c1", T(17), T(18), "fullPerPayer"),
      ]);
      // c1 should have exactly one claim with 120 minutes
      const c1Claims = claims.filter((c) => c.clientId === "c1");
      expect(c1Claims).toHaveLength(1);
      expect(c1Claims[0].minutes).toBe(120);
      // c2 should have exactly one claim with 180 minutes
      const c2Claims = claims.filter((c) => c.clientId === "c2");
      expect(c2Claims).toHaveLength(1);
      expect(c2Claims[0].minutes).toBe(180);
    });
  });

  describe("splitEvenly rounding", () => {
    it("derives amount from rounded minutes so a payer's own arithmetic reconciles", () => {
      // Three participants sharing 100 minutes, which does not divide evenly.
      // Each is there for 33.33... minutes; a part minute is a minute worked,
      // so it rounds UP to 34 rather than shaving the fraction off all three.
      const claims = allocateTime([
        p("c1", "2026-03-01T15:00:00.000Z", "2026-03-01T16:40:00.000Z", "splitEvenly"),
        p("c2", "2026-03-01T15:00:00.000Z", "2026-03-01T16:40:00.000Z", "splitEvenly"),
        p("c3", "2026-03-01T15:00:00.000Z", "2026-03-01T16:40:00.000Z", "splitEvenly"),
      ]);
      const expectedMinutes = 34;
      const expectedAmount = Math.ceil((expectedMinutes / 60) * 3000);
      claims.forEach((claim) => {
        expect(claim.minutes).toBe(expectedMinutes);
        expect(claim.amount).toBe(expectedAmount);
      });
    });
  });
});
