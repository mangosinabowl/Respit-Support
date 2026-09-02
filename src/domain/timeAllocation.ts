import { minutesBetween, type Id, type Money } from "./primitives";
import type { Participant } from "./entities";
import { segmentsFor } from "./segments";

export interface TimeClaim {
  clientId: Id;
  payerPartyId: Id;
  minutes: number;
  /** minutes / 60 * payRate, rounded to the nearest cent. */
  amount: Money;
}

/**
 * Turns participants into per-payer time claims.
 *
 * `fullPerPayer` (the default): a payer owes the full duration their own
 * client was present, regardless of who else was there. More children means
 * more pay, never a group discount (spec §5.1).
 *
 * `splitEvenly`: a shared stretch is divided among the people set to split it,
 * and only those people. A payer on `fullPerPayer` does not reduce what the
 * splitters owe each other - splitting is an arrangement between the families
 * who agreed to share the cost, not a discount triggered by anyone else being
 * in the room. So a lone splitter alongside two full payers still owes the
 * whole stretch; two splitters alongside a full payer owe half each.
 */
export function allocateTime(participants: Participant[]): TimeClaim[] {
  const present = participants.filter((p) => Date.parse(p.outAt) > Date.parse(p.inAt));
  if (present.length === 0) return [];

  const segments = segmentsFor(present);
  const minutesByClient = new Map<Id, number>();

  for (const p of present) {
    if (p.timeRule === "fullPerPayer") {
      minutesByClient.set(p.clientId, (minutesByClient.get(p.clientId) ?? 0) + minutesBetween(p.inAt, p.outAt));
    }
  }

  for (const seg of segments) {
    const sharing = seg.clientIds.filter(
      (id) => present.find((p) => p.clientId === id)!.timeRule === "splitEvenly",
    );
    if (sharing.length === 0) continue;
    const each = seg.minutes / sharing.length;
    for (const id of sharing) {
      minutesByClient.set(id, (minutesByClient.get(id) ?? 0) + each);
    }
  }

  // Emit one claim per (clientId, payerPartyId) pair, preserving order of first appearance
  const seenPairs = new Set<string>();
  const claims: TimeClaim[] = [];

  for (const p of present) {
    const pairKey = `${p.clientId}:${p.payerPartyId}`;
    if (!seenPairs.has(pairKey)) {
      seenPairs.add(pairKey);
      const minutes = Math.ceil(minutesByClient.get(p.clientId) ?? 0);
      claims.push({
        clientId: p.clientId,
        payerPartyId: p.payerPartyId,
        minutes,
        // Multiply BEFORE dividing. minutes/60 is not representable in binary,
        // so 31/60 * 3000 lands at 1550.0000000000002 and rounding up turns an
        // exact $15.50 into $15.51 - overcharging on a figure the payer can
        // recompute. minutes * payRate is exact integer arithmetic.
        amount: Math.ceil((minutes * p.payRate) / 60),
      });
    }
  }

  return claims;
}
