import type { Id, Money } from "./primitives";
import type { MoneySplit } from "./entities";

export interface Payee {
  clientId: Id;
  payerPartyId: Id;
}

/**
 * Splits `total` as evenly as integer cents allow. Any remainder is handed
 * out one cent at a time from the front, so the parts always sum exactly
 * back to the total (Global Constraints; spec §5).
 */
export function allocateEvenly(total: Money, payees: Payee[]): MoneySplit[] {
  return allocateByWeights(total, payees, payees.map(() => 1));
}

/**
 * Splits `total` in proportion to `weights`. Uses largest-remainder
 * apportionment so the parts sum exactly to the total with no drift.
 */
export function allocateByWeights(
  total: Money,
  payees: Payee[],
  weights: number[],
): MoneySplit[] {
  if (weights.length !== payees.length) {
    throw new Error("allocateByWeights: weights must match payees in length");
  }
  if (payees.length === 0) return [];

  const totalWeight = weights.reduce((t, w) => t + w, 0);
  const effective = totalWeight === 0 ? payees.map(() => 1) : weights;
  const effectiveTotal = effective.reduce((t, w) => t + w, 0);

  const exact = effective.map((w) => (total * w) / effectiveTotal);
  const floors = exact.map(Math.floor);
  let remainder = total - floors.reduce((t, f) => t + f, 0);

  // Largest fractional part first; index breaks ties so output is deterministic.
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);

  const amounts = [...floors];
  for (const { index } of order) {
    if (remainder <= 0) break;
    amounts[index] += 1;
    remainder -= 1;
  }

  return payees.map((p, i) => ({
    clientId: p.clientId,
    payerPartyId: p.payerPartyId,
    amount: amounts[i],
  }));
}
