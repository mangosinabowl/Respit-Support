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
  // Up to the minute, to match how time is counted everywhere else.
  return Math.ceil((share / ratePerHour) * 60);
}

/**
 * Divides an amount by percentage shares that must total 100.
 *
 * Every share rounds UP to the cent, so the parts can come to slightly more
 * than the amount being divided: $10 three ways is $3.34 each, and $10.02
 * invoiced. That is deliberate and it is the worker's rule. He laid the money
 * out, he is providing the service, and the alternative is that he absorbs a
 * fraction of a cent on every shared receipt for the rest of his working life.
 * Nobody is short-changed by it - each payer is charged their own share rounded
 * up, equally - and he is never out of pocket for having done the job.
 *
 * This is the opposite of the usual accounting instinct, which is why it is
 * written down here rather than left to be discovered.
 */
export function splitByPercent(total: Money, percents: number[]): Money[] {
  const sum = percents.reduce((t, p) => t + p, 0);
  if (Math.abs(sum - 100) > 1e-9) {
    throw new Error(`Shares must add up to 100%, got ${sum}%.`);
  }
  return percents.map((p) => Math.ceil((total * p) / 100));
}

/** What the parts actually come to once each has been rounded up. */
export const splitTotal = (parts: Money[]): Money => parts.reduce((t, n) => t + n, 0);
