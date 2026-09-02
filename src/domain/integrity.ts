import type { EntityStore } from "./replay";
import { live } from "./replay";
import { allocateTime } from "./timeAllocation";
import type { Shift, Expense, Trip, Note, Submission } from "./entities";

export interface DataProblem {
  what: string;
  detail: string;
}

/**
 * Looks for records that contradict each other.
 *
 * The per-record checks in invariants.ts ask whether one thing is internally
 * sound. This asks whether the whole set hangs together: an invoice whose total
 * does not match the work it names, a receipt attached to a shift its people
 * were never on, work marked sent against an invoice that does not exist.
 *
 * Those are the failures that stay quiet. A wrong figure inside one record gets
 * noticed; a figure that disagrees with a different record does not, until a
 * payer asks about it.
 */
export function checkData(store: EntityStore): DataProblem[] {
  const problems: DataProblem[] = [];
  const shifts = live(store, "shift") as unknown as Shift[];
  const expenses = live(store, "expense") as unknown as Expense[];
  const trips = live(store, "trip") as unknown as Trip[];
  const notes = live(store, "note") as unknown as Note[];
  const submissions = live(store, "submission") as unknown as Submission[];

  const shiftById = new Map(shifts.map((s) => [s.id, s]));
  const submissionIds = new Set(submissions.map((s) => s.id));

  for (const s of submissions) {
    const parts = s.time + s.expenses + s.mileage + (s.adjustments ?? 0);
    if (s.amount !== parts) {
      problems.push({
        what: `Invoice for ${s.clientName}`,
        detail: `says ${money(s.amount)} but its own parts come to ${money(parts)}.`,
      });
    }
  }

  // An item attached to a shift its people were never on would bill a payer for
  // time their person was not there.
  const wrongShift = (kind: string, id: string, label: string, shiftId: string | null | undefined, clientIds: string[]) => {
    if (!shiftId) return;
    const shift = shiftById.get(shiftId);
    if (!shift) {
      problems.push({ what: `${kind} "${label}"`, detail: "is attached to a shift that no longer exists." });
      return;
    }
    const missing = clientIds.filter((c) => !shift.participants.some((p) => p.clientId === c));
    if (missing.length) {
      problems.push({ what: `${kind} "${label}"`, detail: `is on a shift that ${missing.length === 1 ? "one of its people was" : "some of its people were"} not present for.` });
    }
  };
  for (const e of expenses) wrongShift("Expense", e.id, e.description, e.shiftId, e.splits.map((sp) => sp.clientId));
  for (const t of trips) wrongShift("Trip", t.id, t.purpose, t.shiftId, t.splits.map((sp) => sp.clientId));

  for (const r of [...shifts, ...expenses, ...trips]) {
    if (r.reimbursementStatus !== "submitted") continue;
    if (!r.submissionId || !submissionIds.has(r.submissionId)) {
      problems.push({
        what: `A ${"participants" in r ? "shift" : "totalAmount" in r ? "expense" : "trip"} marked as sent`,
        detail: "does not belong to any invoice, so it cannot be chased or brought back.",
      });
    }
  }

  for (const n of notes) {
    if (n.attachedToType === "shift" && !shiftById.has(n.attachedToId)) {
      problems.push({ what: "A note", detail: "is attached to a shift that no longer exists." });
    }
  }

  for (const s of shifts) {
    if (!s.endAt) continue;
    if (Date.parse(s.endAt) <= Date.parse(s.startAt)) {
      problems.push({ what: "A shift", detail: "ends before it starts." });
    }
    if (!allocateTime(s.participants).length && s.participants.length) {
      problems.push({ what: "A shift", detail: "has people on it but bills nothing, so nobody is being charged for it." });
    }
  }

  return problems;
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
