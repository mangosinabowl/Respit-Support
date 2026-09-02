import type { Money } from "./primitives";

export interface TripShare {
  /** This person's portion of the distance, in the trip's own unit. */
  distanceShare: number;
  claim: Money;
}

/**
 * Divides a trip between the people carried.
 *
 * Each person gets a portion of the DISTANCE, and their claim is that portion
 * times the snapshotted rate. That is the shape checkTrip enforces: a split
 * whose claim does not equal its own distance times its own rate is rejected,
 * because a payer can and will recompute it.
 *
 * The total is therefore the sum of the individual claims, which can differ by
 * a cent from rounding the whole trip once. Per-split correctness wins: each
 * line has to stand on its own on an invoice.
 *
 * Fuel at the pump is deliberately not an input. It is recorded on the trip for
 * the worker's own records and never enters a claim (spec 4.6) - mileage
 * already covers running the car, so claiming both bills the same cost twice.
 */
export function tripShares(distance: number, ratePerUnit: Money, percents: number[]): { shares: TripShare[]; total: Money } {
  if (!Number.isFinite(distance) || distance < 0) throw new Error("Distance must be zero or more.");
  if (ratePerUnit < 0) throw new Error("A mileage rate cannot be negative.");
  const sum = percents.reduce((t, p) => t + p, 0);
  if (percents.length && Math.abs(sum - 100) > 1e-9) {
    throw new Error(`Shares must add up to 100%, got ${sum}%.`);
  }
  const shares = percents.map((p) => {
    const distanceShare = (distance * p) / 100;
    return { distanceShare, claim: Math.ceil(distanceShare * ratePerUnit) };
  });
  return { shares, total: shares.reduce((t, s) => t + s.claim, 0) };
}
