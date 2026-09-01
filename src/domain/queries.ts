import type { Id, Money } from "./primitives";
import type { Expense, Shift, Trip } from "./entities";
import { live, type EntityStore } from "./replay";
import { allocateTime } from "./timeAllocation";

export interface OwedRow {
  payerPartyId: Id;
  unclaimed: Money;
  submitted: Money;
  paid: Money;
}

type Bucket = "unclaimed" | "submitted" | "paid";

function bucketOf(status: string): Bucket | null {
  if (status === "unclaimed" || status === "submitted" || status === "paid") return status;
  if (status === "notReimbursable") return null; // genuinely owed by nobody
  // Anything else - a missing status, or one this build does not recognise -
  // is treated as unclaimed rather than dropped. Silently omitting a record
  // means work that never reaches an invoice and nothing on screen to hint it
  // exists; showing it as unclaimed is visible and correctable.
  return "unclaimed";
}

/** What each payer owes right now, split into unclaimed, waiting, and paid. */
export function owedByPayer(store: EntityStore): OwedRow[] {
  const rows = new Map<Id, OwedRow>();

  const add = (payerPartyId: Id, bucket: Bucket, amount: Money) => {
    const row = rows.get(payerPartyId) ?? { payerPartyId, unclaimed: 0, submitted: 0, paid: 0 };
    row[bucket] += amount;
    rows.set(payerPartyId, row);
  };

  for (const shift of live(store, "shift") as unknown as Shift[]) {
    const bucket = bucketOf(shift.reimbursementStatus);
    if (!bucket || !shift.endAt) continue;
    for (const claim of allocateTime(shift.participants ?? [])) {
      add(claim.payerPartyId, bucket, claim.amount);
    }
  }

  for (const expense of live(store, "expense") as unknown as Expense[]) {
    const bucket = bucketOf(expense.reimbursementStatus);
    if (!bucket) continue;
    for (const s of expense.splits ?? []) add(s.payerPartyId, bucket, s.amount);
  }

  for (const trip of live(store, "trip") as unknown as Trip[]) {
    const bucket = bucketOf(trip.reimbursementStatus);
    if (!bucket || !trip.isClaimable) continue;
    for (const s of trip.splits ?? []) add(s.payerPartyId, bucket, s.claimAmount);
  }

  return [...rows.values()].sort((a, b) => a.payerPartyId.localeCompare(b.payerPartyId));
}
