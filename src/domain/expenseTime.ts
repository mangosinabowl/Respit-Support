import type { Money } from "./primitives";

/**
 * What an expense share looks like to a payer who funds hours, not receipts.
 *
 * The rate is never touched. A share of a receipt is expressed as the extra
 * time it is worth at the rate already agreed for that person, so their invoice
 * reads as hours of support and nothing else (the worker's own view keeps the
 * receipt as money - see owedByPayer).
 *
 * Rounded to the nearest whole minute, because a payer cannot be invoiced for
 * a fraction of a minute and the worker should not lose a cent to it either.
 */
export function expenseAsMinutes(share: Money, ratePerHour: Money): number {
  if (ratePerHour <= 0) return 0; // no agreed rate, so nothing to convert against
  return Math.round((share / ratePerHour) * 60);
}

/**
 * Divides an amount by percentage shares that must total 100.
 *
 * Every cent is accounted for: the largest remainders receive the leftover
 * cents one at a time, so the parts always sum back to the original exactly.
 * Splitting a receipt must never invent or lose money.
 */
export function splitByPercent(total: Money, percents: number[]): Money[] {
  const sum = percents.reduce((t, p) => t + p, 0);
  if (Math.abs(sum - 100) > 1e-9) {
    throw new Error(`Shares must add up to 100%, got ${sum}%.`);
  }
  const exact = percents.map((p) => (total * p) / 100);
  const floors = exact.map(Math.floor);
  let left = total - floors.reduce((t, n) => t + n, 0);

  // Hand the leftover cents to the largest fractional parts first.
  const order = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const out = [...floors];
  for (const { i } of order) {
    if (left <= 0) break;
    out[i] += 1;
    left -= 1;
  }
  return out;
}
