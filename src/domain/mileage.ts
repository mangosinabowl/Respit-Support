import type { Money } from "./primitives";
import { splitByPercent } from "./expenseTime";

/**
 * What a trip is worth, and how it divides between the people carried.
 *
 * Distance times rate, rounded to whole cents once at the end rather than per
 * person, then divided by the agreed shares so the parts always sum back to
 * the claim exactly.
 *
 * Fuel at the pump is deliberately not an input here: it is recorded on the
 * trip for the worker's own records and never enters a claim (spec 4.6).
 * Claiming both mileage and fuel would be billing the same cost twice.
 */
export function tripClaim(distance: number, ratePerUnit: Money, percents: number[]): { total: Money; shares: Money[] } {
  if (!Number.isFinite(distance) || distance < 0) throw new Error("Distance must be zero or more.");
  if (ratePerUnit < 0) throw new Error("A mileage rate cannot be negative.");
  const total = Math.round(distance * ratePerUnit);
  return { total, shares: splitByPercent(total, percents) };
}
