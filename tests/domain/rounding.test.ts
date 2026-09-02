import { describe, it, expect } from "vitest";
import { minutesBetween } from "../../src/domain/primitives";
import { allocateTime } from "../../src/domain/timeAllocation";
import { tripShares } from "../../src/domain/mileage";
import { splitByPercent, expenseAsMinutes } from "../../src/domain/expenseTime";

const T = (h: number, m = 0, s = 0) =>
  `2026-03-01T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.000Z`;

describe("time rounds up to the minute", () => {
  it("counts a part minute as a minute worked", () => {
    expect(minutesBetween(T(9), T(9, 0, 1))).toBe(1);   // one second is a minute
    expect(minutesBetween(T(9), T(9, 30, 20))).toBe(31); // 30m20s
    expect(minutesBetween(T(9), T(10))).toBe(60);        // exact stays exact
  });

  it("never returns a negative, whatever the times say", () => {
    // An outAt before inAt is bad data, not a credit against the payer.
    expect(minutesBetween(T(10), T(9))).toBe(0);
  });
});

describe("money rounds up to the cent", () => {
  it("gives the worker the fraction on a shift", () => {
    // 31 minutes at $30/hr is 1550.0 cents exactly; 37 minutes is 1850.0.
    // 7 minutes at $33.33/hr is 388.85 cents, which must land on 389.
    const claims = allocateTime([
      { clientId: "c1", payerPartyId: "p1", inAt: T(9), outAt: T(9, 7), payRate: 3333, timeRule: "fullPerPayer" },
    ] as any);
    expect(claims[0].amount).toBe(389);
  });

  it("gives the worker the fraction on mileage", () => {
    // 7.5 km at 33c is 247.5 cents.
    expect(tripShares(7.5, 33, [100]).shares[0].claim).toBe(248);
  });

  it("turns an outlay into time rounded up", () => {
    expect(expenseAsMinutes(1000, 3300)).toBe(19); // 18.18 minutes
  });
});

describe("dividing a known total still lands exactly", () => {
  it("does NOT round each share up, because that would invent money", () => {
    // Rounding up three shares of $10 would come to $10.02 and hand the worker
    // two cents that nobody paid. A receipt is a fixed amount being divided,
    // not a rate being applied, so the remainder is distributed instead.
    const parts = splitByPercent(1000, [100 / 3, 100 / 3, 100 / 3]);
    expect(parts.reduce((t, n) => t + n, 0)).toBe(1000);
    expect(parts).toEqual([334, 333, 333]);
  });

  it("holds for awkward percentages too", () => {
    for (const total of [999, 1, 12345, 100]) {
      const parts = splitByPercent(total, [17.5, 33.3, 49.2]);
      expect(parts.reduce((t, n) => t + n, 0), `total ${total}`).toBe(total);
    }
  });
});
