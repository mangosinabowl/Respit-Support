import { describe, it, expect } from "vitest";
import { tripShares } from "../../src/domain/mileage";
import { checkTrip } from "../../src/domain/invariants";

/** Builds the trip a UI would store from these shares, to check it validates. */
const tripFrom = (distance: number, rate: number, percents: number[]) => {
  const { shares } = tripShares(distance, rate, percents);
  return {
    id: "t1", occurredAt: "2026-03-01T10:00:00.000Z", recordedAt: "2026-03-01T10:00:00.000Z",
    zone: "UTC", tags: [], customFields: {},
    distance, distanceUnit: "km" as const, purpose: "Swimming", isClaimable: true,
    reimbursementStatus: "unclaimed" as const,
    splits: shares.map((s, i) => ({
      clientId: `c${i}`, payerPartyId: `p${i}`,
      distanceShare: s.distanceShare, rateApplied: rate, claimAmount: s.claim,
    })),
  };
};

describe("tripShares", () => {
  it("gives one person the whole distance", () => {
    const { shares, total } = tripShares(12, 68, [100]);
    expect(shares).toEqual([{ distanceShare: 12, claim: 816 }]);
    expect(total).toBe(816);
  });

  it("splits the distance, not just the money", () => {
    const { shares } = tripShares(10, 100, [50, 50]);
    // Each person's claim must be recomputable from their own kilometres.
    expect(shares).toEqual([{ distanceShare: 5, claim: 500 }, { distanceShare: 5, claim: 500 }]);
  });

  it("produces splits that pass checkTrip", () => {
    // This is the point: a payer will recompute distance x rate, so every split
    // has to survive that arithmetic.
    expect(checkTrip(tripFrom(12, 68, [100]))).toEqual([]);
    expect(checkTrip(tripFrom(10, 100, [50, 50]))).toEqual([]);
    expect(checkTrip(tripFrom(7.5, 33, [100 / 3, 100 / 3, 100 / 3]))).toEqual([]);
    expect(checkTrip(tripFrom(13, 47, [70, 30]))).toEqual([]);
  });

  it("keeps a zero-distance trip valid rather than inventing money", () => {
    const { shares, total } = tripShares(0, 68, [100]);
    expect(total).toBe(0);
    expect(shares[0].claim).toBe(0);
    expect(checkTrip(tripFrom(0, 68, [100]))).toEqual([]);
  });

  it("refuses nonsense", () => {
    expect(() => tripShares(-5, 68, [100])).toThrow(/zero or more/);
    expect(() => tripShares(10, -1, [100])).toThrow(/negative/);
    expect(() => tripShares(10, 68, [50, 40])).toThrow(/add up to 100/);
  });
});
