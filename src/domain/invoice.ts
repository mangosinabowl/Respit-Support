import type { Adjustment, Expense, Shift, Trip } from "./entities";
import type { Id, Money } from "./primitives";
import { allocateTime } from "./timeAllocation";
import { minutesBetween } from "./primitives";

export interface InvoiceLine {
  kind: "time" | "expense" | "mileage" | "adjustment";
  /** The record this line came from, so a caller can let the user deselect it. */
  sourceId: string;
  /** Where it stands: already sent to the payer, or not yet claimed. */
  status?: string;
  when: string;
  detail: string;
  /** Hours and rate for a time line, so a payer can check the arithmetic. */
  quantity?: string;
  amount: Money;
  note?: string;
}

export interface Invoice {
  payerPartyId: Id;
  clientId: Id;
  clientName: string;
  lines: InvoiceLine[];
  time: Money;
  expenses: Money;
  mileage: Money;
  adjustments: Money;
  total: Money;
  /** Present only on a draft, so the worker can see what a final would hide. */
  adjustmentLines: InvoiceLine[];
}

/**
 * Everything one payer owes, itemised so the cost can be proved rather than
 * asserted. Each line stands on its own: a payer who recomputes hours times
 * rate, or distance times rate, must arrive at the same figure.
 *
 * `applyAdjustments` folds late changes into the total. A draft leaves them
 * visible as their own lines; a final invoice includes them in the total and
 * lists them plainly, never silently - a total that cannot be reconciled from
 * the lines above it is what makes a payer query an invoice.
 */
export function buildInvoice(
  payerPartyId: Id,
  clientId: Id,
  clientName: string,
  shifts: Shift[],
  expenses: Expense[],
  trips: Trip[],
  adjustments: Adjustment[],
  statuses: readonly string[] = ["unclaimed", "submitted"],
): Invoice {
  const lines: InvoiceLine[] = [];
  let time = 0;

  for (const s of shifts) {
    if (!statuses.includes(s.reimbursementStatus) || !s.endAt) continue;
    for (const claim of allocateTime(s.participants)) {
      if (claim.payerPartyId !== payerPartyId) continue;
      const p = s.participants.find((x) => x.payerPartyId === payerPartyId)!;
      const mins = minutesBetween(p.inAt, p.outAt);
      lines.push({
        kind: "time",
        sourceId: s.id,
        status: s.reimbursementStatus,
        when: s.startAt,
        detail: `Support for ${clientName}`,
        quantity: `${(claim.minutes / 60).toFixed(2)} h at ${(p.payRate / 100).toFixed(2)}/h${claim.minutes !== mins ? " (shared)" : ""}`,
        amount: claim.amount,
      });
      time += claim.amount;
    }
  }

  let expenseTotal = 0;
  for (const e of expenses) {
    if (!statuses.includes(e.reimbursementStatus)) continue;
    for (const sp of e.splits) {
      if (sp.payerPartyId !== payerPartyId) continue;
      lines.push({ kind: "expense", sourceId: e.id, status: e.reimbursementStatus, when: e.occurredAt, detail: e.description || "Expense", amount: sp.amount });
      expenseTotal += sp.amount;
    }
  }

  let mileage = 0;
  for (const t of trips) {
    if (!statuses.includes(t.reimbursementStatus) || !t.isClaimable) continue;
    for (const sp of t.splits) {
      if (sp.payerPartyId !== payerPartyId) continue;
      lines.push({
        kind: "mileage",
        sourceId: t.id,
        status: t.reimbursementStatus,
        when: t.occurredAt,
        detail: t.purpose || "Trip",
        quantity: `${sp.distanceShare.toFixed(1)} ${t.distanceUnit} at ${(sp.rateApplied / 100).toFixed(2)}/${t.distanceUnit}`,
        amount: sp.claimAmount,
      });
      mileage += sp.claimAmount;
    }
  }

  const mine = adjustments.filter((a) => a.payerPartyId === payerPartyId);
  const adjustmentLines: InvoiceLine[] = mine.map((a) => ({
    kind: "adjustment",
    sourceId: a.id,
    when: a.occurredAt,
    detail: a.note || "Adjustment",
    amount: a.amountDelta,
    note: a.note,
  }));
  const adjustmentsTotal = mine.reduce((t, a) => t + a.amountDelta, 0);

  lines.sort((a, b) => a.when.localeCompare(b.when));

  return {
    payerPartyId, clientId, clientName, lines,
    time, expenses: expenseTotal, mileage,
    adjustments: adjustmentsTotal,
    total: time + expenseTotal + mileage + adjustmentsTotal,
    adjustmentLines,
  };
}
