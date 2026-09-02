import { allocateByWeights } from "./allocation";
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
 * The apportionment itself is allocateByWeights, which already implements
 * largest-remainder for this codebase. Two implementations of "split money
 * without losing a cent" is one too many: they drift apart, and then two
 * screens disagree about the same receipt.
 *
 * What this adds is the rule that the shares must actually add up to 100 -
 * silently normalising 90% into a whole receipt would hide a mistake the user
 * meant to make visible.
 */
export function splitByPercent(total: Money, percents: number[]): Money[] {
  const sum = percents.reduce((t, p) => t + p, 0);
  if (Math.abs(sum - 100) > 1e-9) {
    throw new Error(`Shares must add up to 100%, got ${sum}%.`);
  }
  const payees = percents.map((_, i) => ({ clientId: `i${i}`, payerPartyId: `i${i}` }));
  return allocateByWeights(total, payees, percents).map((s) => s.amount);
}
