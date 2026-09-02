import { describe, it, expect } from "vitest";
import { tripClaim } from "../../src/domain/mileage";

describe("tripClaim", () => {
  it("is distance times the snapshotted rate", () => {
    expect(tripClaim(12, 68, [100]).total).toBe(816); // 12 km at 68c
  });

  it("divides between everyone carried, to the cent", () => {
    const { total, shares } = tripClaim(10, 100, [100 / 3, 100 / 3, 100 / 3]);
    expect(total).toBe(1000);
    expect(shares.reduce((t, n) => t + n, 0)).toBe(1000);
    expect(shares).toEqual([334, 333, 333]);
  });

  it("rounds once on the whole trip, not per person", () => {
    // 7.5 km at 33c is 247.5c. Rounding per person first would lose or invent
    // cents; rounding the trip once and then splitting cannot.
    const { total, shares } = tripClaim(7.5, 33, [50, 50]);
    expect(total).toBe(248);
    expect(shares.reduce((t, n) => t + n, 0)).toBe(248);
  });

  it("handles a zero-distance trip without inventing money", () => {
    expect(tripClaim(0, 68, [100])).toEqual({ total: 0, shares: [0] });
  });

  it("refuses nonsense", () => {
    expect(() => tripClaim(-5, 68, [100])).toThrow(/zero or more/);
    expect(() => tripClaim(10, -1, [100])).toThrow(/negative/);
    expect(() => tripClaim(10, 68, [50, 40])).toThrow(/add up to 100/);
  });
});
