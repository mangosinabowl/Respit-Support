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
 * `splitEvenly`: shared stretches are divided among everyone present during
 * that stretch, so total billed time never exceeds time actually worked.
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
    const each = seg.minutes / seg.clientIds.length;
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
      const minutes = Math.round(minutesByClient.get(p.clientId) ?? 0);
      claims.push({
        clientId: p.clientId,
        payerPartyId: p.payerPartyId,
        minutes,
        amount: Math.round((minutes / 60) * p.payRate),
      });
    }
  }

  return claims;
}
