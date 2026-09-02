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

describe("dividing a receipt rounds up too", () => {
  it("charges each share rounded up, even though that exceeds the receipt", () => {
    // The deliberate rule: $10 three ways is $3.34 each, $10.02 charged. The
    // worker paid the $10 and is providing the service; he does not absorb the
    // fraction, and every payer is charged the same as the others.
    const parts = splitByPercent(1000, [100 / 3, 100 / 3, 100 / 3]);
    expect(parts).toEqual([334, 334, 334]);
    expect(parts.reduce((t, n) => t + n, 0)).toBe(1002);
  });

  it("never comes to less than the receipt", () => {
    // The direction is what matters: it may exceed, it may never fall short,
    // because falling short means working at a loss.
    for (const total of [999, 1, 12345, 100, 3333]) {
      for (const shares of [[17.5, 33.3, 49.2], [50, 50], [100], [25, 25, 25, 25]]) {
        const parts = splitByPercent(total, shares);
        const sum = parts.reduce((t, n) => t + n, 0);
        expect(sum, `${total} by ${shares.join("/")}`).toBeGreaterThanOrEqual(total);
        // And never more than one cent per share above it.
        expect(sum - total).toBeLessThanOrEqual(shares.length);
      }
    }
  });
});
