import type { Expense, Shift, Trip } from "./entities";
import type { Money } from "./primitives";

export interface Violation {
  code: string;
  message: string;
  field?: string;
}

function dollars(cents: Money): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function checkExpense(expense: Expense): Violation[] {
  const violations: Violation[] = [];

  if (expense.totalAmount <= 0) {
    violations.push({
      code: "NON_POSITIVE_TOTAL",
      message: "An expense must be more than zero.",
      field: "totalAmount",
    });
  }

  if (expense.splits.length === 0) {
    violations.push({
      code: "NO_SPLITS",
      message: "Nobody is assigned to pay this back.",
      field: "splits",
    });
  } else {
    const sum = expense.splits.reduce((t, s) => t + s.amount, 0);
    if (sum !== expense.totalAmount) {
      const diff = expense.totalAmount - sum;
      violations.push({
        code: "SPLITS_DO_NOT_SUM",
        message:
          diff > 0
            ? `$${dollars(diff)} of this expense is not assigned to anyone.`
            : `$${dollars(-diff)} more than the receipt is assigned out.`,
        field: "splits",
      });
    }
  }

  if (expense.receiptAttachmentIds.length === 0) {
    violations.push({
      code: "NO_RECEIPT",
      message: "No receipt photo attached.",
      field: "receiptAttachmentIds",
    });
  }

  return violations;
}

export function checkTrip(trip: Trip): Violation[] {
  const violations: Violation[] = [];
  if (!trip.isClaimable) return violations;

  if (trip.splits.length === 0) {
    violations.push({
      code: "NO_SPLITS",
      message: "Nobody is assigned to reimburse this trip.",
      field: "splits",
    });
  }

  for (const s of trip.splits) {
    const expected = Math.round(s.distanceShare * s.rateApplied);
    if (s.claimAmount !== expected) {
      violations.push({
        code: "CLAIM_MISMATCH",
        message: `Claim of $${dollars(s.claimAmount)} does not match ${s.distanceShare} × the rate ($${dollars(expected)}).`,
        field: "splits",
      });
    }
  }

  return violations;
}

export function checkShift(shift: Shift): Violation[] {
  const violations: Violation[] = [];

  if (shift.participants.length === 0) {
    violations.push({
      code: "NO_PARTICIPANTS",
      message: "This shift has nobody on it.",
      field: "participants",
    });
  }

  if (!shift.endAt) {
    violations.push({
      code: "STILL_RUNNING",
      message: "This shift has not been stopped yet.",
      field: "endAt",
    });
    return violations;
  }

  if (Date.parse(shift.endAt) < Date.parse(shift.startAt)) {
    violations.push({
      code: "END_BEFORE_START",
      message: "The shift ends before it starts.",
      field: "endAt",
    });
  }

  for (const p of shift.participants) {
    if (
      Date.parse(p.inAt) < Date.parse(shift.startAt) ||
      Date.parse(p.outAt) > Date.parse(shift.endAt)
    ) {
      violations.push({
        code: "PARTICIPANT_OUTSIDE_SHIFT",
        message: "Someone's times fall outside the shift.",
        field: "participants",
      });
    }
  }

  return violations;
}

export function isSubmittable(violations: Violation[]): boolean {
  return violations.length === 0;
}
