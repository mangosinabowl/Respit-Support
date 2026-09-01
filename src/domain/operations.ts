import { makeEvent, type DomainEvent } from "./events";
import { newId, type Id } from "./primitives";
import type { Expense, MoneySplit, Participant, ReimbursementStatus, Shift } from "./entities";

/**
 * Every operation here returns the events to append and mutates nothing.
 * Because the log is append-only, splits and merges are reversible and the
 * originals remain recoverable (spec §8).
 */

/** Only an unclaimed record may be rewritten; anything already in the
 * reimbursement pipeline must be left alone. Names the actual status in the
 * message rather than assuming "submitted" — the record could equally be
 * "paid" or "notReimbursable". */
function assertUnclaimed(status: ReimbursementStatus, subject: string): void {
  if (status !== "unclaimed") {
    throw new Error(`Cannot modify ${subject}: status is "${status}", not unclaimed.`);
  }
}

function participantKey(p: Participant): string {
  return `${p.clientId}::${p.payerPartyId}`;
}

/**
 * Unions two shifts' participant lists. A (clientId, payerPartyId) pair
 * present in both shifts is folded into a single row spanning the earliest
 * inAt to the latest outAt — otherwise the same real-world presence would be
 * billed twice (e.g. two shifts logged for the same child that should have
 * been one). A pair present in only one shift passes through unchanged.
 *
 * Rates are snapshotted and never recomputed, so two rows for the same pair
 * that disagree on payRate or timeRule cannot be honestly unioned — that is
 * refused rather than guessed at.
 */
function unionParticipants(a: Participant[], b: Participant[]): Participant[] {
  const bByKey = new Map(b.map((p) => [participantKey(p), p]));
  const seen = new Set<string>();
  const merged: Participant[] = [];

  for (const pa of a) {
    const key = participantKey(pa);
    seen.add(key);
    const pb = bByKey.get(key);
    if (!pb) {
      merged.push(pa);
      continue;
    }
    if (pa.payRate !== pb.payRate || pa.timeRule !== pb.timeRule) {
      throw new Error(
        `Cannot merge: client "${pa.clientId}" has a different pay rate or time rule in each shift.`,
      );
    }
    merged.push({
      ...pa,
      inAt: Date.parse(pa.inAt) < Date.parse(pb.inAt) ? pa.inAt : pb.inAt,
      outAt: Date.parse(pa.outAt) > Date.parse(pb.outAt) ? pa.outAt : pb.outAt,
    });
  }

  for (const pb of b) {
    if (!seen.has(participantKey(pb))) merged.push(pb);
  }

  return merged;
}

export function splitShiftAt(
  shift: Shift,
  at: string,
  deviceId: Id,
  startSeq: number,
): DomainEvent[] {
  // Validate the split point before anything else: Date.parse of a bad
  // string is NaN, and every comparison against NaN is false, so an
  // unvalidated guard below would silently pass a typo through, soft-delete
  // the shift, and clamp every participant to a zero-length window.
  if (!Number.isFinite(Date.parse(at))) {
    throw new Error(`Cannot split at "${at}": not a valid instant.`);
  }
  assertUnclaimed(shift.reimbursementStatus, "a shift");
  if (!shift.endAt) throw new Error("Cannot split a shift that is still running.");
  if (Date.parse(at) <= Date.parse(shift.startAt) || Date.parse(at) >= Date.parse(shift.endAt)) {
    throw new Error("The split point must fall within the shift.");
  }

  const clamp = (from: string, to: string) =>
    shift.participants
      .map((p) => ({
        ...p,
        inAt: Date.parse(p.inAt) > Date.parse(from) ? p.inAt : from,
        outAt: Date.parse(p.outAt) < Date.parse(to) ? p.outAt : to,
      }))
      .filter((p) => Date.parse(p.outAt) > Date.parse(p.inAt));

  const firstId = newId();
  const secondId = newId();

  return [
    makeEvent("shift", firstId, { ...shift, id: firstId, startAt: shift.startAt, endAt: at, occurredAt: shift.startAt, participants: clamp(shift.startAt, at) }, deviceId, startSeq),
    makeEvent("shift", secondId, { ...shift, id: secondId, startAt: at, endAt: shift.endAt, occurredAt: at, participants: clamp(at, shift.endAt) }, deviceId, startSeq + 1),
    makeEvent("shift", shift.id, { deleted: true, splitInto: [firstId, secondId] }, deviceId, startSeq + 2),
  ];
}

export function mergeShifts(a: Shift, b: Shift, deviceId: Id, startSeq: number): DomainEvent[] {
  for (const s of [a, b]) {
    assertUnclaimed(s.reimbursementStatus, "a shift");
  }
  if (!a.endAt || !b.endAt) throw new Error("Cannot merge a shift that is still running.");

  const startAt = Date.parse(a.startAt) < Date.parse(b.startAt) ? a.startAt : b.startAt;
  const endAt = Date.parse(a.endAt) > Date.parse(b.endAt) ? a.endAt : b.endAt;
  // Union first: a same-client rate/timeRule conflict must abort before any
  // event is built, and a duplicate or overlapping pair must collapse to one
  // row rather than billing the same real-world presence twice.
  const participants = unionParticipants(a.participants, b.participants);
  const mergedId = newId();

  return [
    makeEvent("shift", mergedId, {
      ...a,
      id: mergedId,
      startAt,
      endAt,
      occurredAt: startAt,
      participants,
      isIncident: a.isIncident || b.isIncident,
      // a's tags/customFields/zone alone would silently drop b's — union the
      // tags, merge customFields (a wins on key conflict). zone is left as
      // a's; see task report for the known limitation.
      tags: [...new Set([...a.tags, ...b.tags])],
      customFields: { ...b.customFields, ...a.customFields },
      mergedFrom: [a.id, b.id],
    }, deviceId, startSeq),
    makeEvent("shift", a.id, { deleted: true, mergedInto: mergedId }, deviceId, startSeq + 1),
    makeEvent("shift", b.id, { deleted: true, mergedInto: mergedId }, deviceId, startSeq + 2),
  ];
}

export interface ExpensePart {
  description: string;
  totalAmount: number;
  splits: MoneySplit[];
}

export function splitExpense(
  expense: Expense,
  parts: ExpensePart[],
  deviceId: Id,
  startSeq: number,
): DomainEvent[] {
  assertUnclaimed(expense.reimbursementStatus, "an expense");
  const sum = parts.reduce((t, p) => t + p.totalAmount, 0);
  if (sum !== expense.totalAmount) {
    throw new Error("The parts must sum to the original expense total.");
  }

  const partIds = parts.map(() => newId());
  const events = parts.map((part, i) =>
    makeEvent("expense", partIds[i], {
      ...expense,
      id: partIds[i],
      description: part.description,
      totalAmount: part.totalAmount,
      splits: part.splits,
      // The receipt image belongs to every part it came from (spec §5.2).
      receiptAttachmentIds: [...expense.receiptAttachmentIds],
      splitFrom: expense.id,
    }, deviceId, startSeq + i),
  );

  events.push(
    makeEvent("expense", expense.id, { deleted: true, splitInto: partIds }, deviceId, startSeq + parts.length),
  );
  return events;
}

export function moveExpense(
  expense: Expense,
  toShiftId: Id | null | undefined,
  deviceId: Id,
  startSeq: number,
): DomainEvent[] {
  assertUnclaimed(expense.reimbursementStatus, "an expense");
  // Emit null, never undefined: events travel as JSONL between devices, and
  // JSON.stringify drops a key whose value is undefined, silently turning
  // this into a no-op that leaves the expense attached to its old shift.
  return [makeEvent("expense", expense.id, { shiftId: toShiftId ?? null }, deviceId, startSeq)];
}
