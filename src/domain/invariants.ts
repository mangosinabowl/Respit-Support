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

function isValidTimestamp(timestamp: string): boolean {
  const parsed = Date.parse(timestamp);
  return !isNaN(parsed);
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
      message: `$${dollars(expense.totalAmount)} is not assigned to anyone.`,
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
    // Note: We reject negative (<0), not non-positive (<=0), unlike checkExpense's NON_POSITIVE_TOTAL.
    // A $0.00 trip split can arise legitimately from largest-remainder allocation when a small
    // distanceShare rounds to zero cents. Accepting zero here avoids blocking a correct trip that
    // the worker cannot fix; rejecting it would create an unsolvable error. Expenses are different:
    // a $0.00 receipt is unambiguously an error.
    if (s.distanceShare < 0 || s.claimAmount < 0) {
      violations.push({
        code: "NEGATIVE_CLAIM",
        message: `A trip claim cannot be negative.`,
        field: "splits",
      });
      continue;
    }

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

  if (!isValidTimestamp(shift.startAt)) {
    violations.push({
      code: "BAD_TIMESTAMP",
      message: "The shift start time is not a valid timestamp.",
      field: "startAt",
    });
    return violations;
  }

  if (!isValidTimestamp(shift.endAt)) {
    violations.push({
      code: "BAD_TIMESTAMP",
      message: "The shift end time is not a valid timestamp.",
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
    if (!isValidTimestamp(p.inAt)) {
      violations.push({
        code: "BAD_TIMESTAMP",
        message: `Participant ${p.clientId} has an invalid in-time.`,
        field: "participants",
      });
      continue;
    }

    if (!isValidTimestamp(p.outAt)) {
      violations.push({
        code: "BAD_TIMESTAMP",
        message: `Participant ${p.clientId} has an invalid out-time.`,
        field: "participants",
      });
      continue;
    }

    if (
      Date.parse(p.inAt) < Date.parse(shift.startAt) ||
      Date.parse(p.outAt) > Date.parse(shift.endAt)
    ) {
      violations.push({
        code: "PARTICIPANT_OUTSIDE_SHIFT",
        message: `Participant ${p.clientId}'s times fall outside the shift.`,
        field: "participants",
      });
    }
  }

  return violations;
}

export function isSubmittable(violations: Violation[]): boolean {
  return violations.length === 0;
}
