import { makeEvent, type DomainEvent } from "./events";
import { newId, type Id } from "./primitives";
import type { Expense, MoneySplit, Shift } from "./entities";

/**
 * Every operation here returns the events to append and mutates nothing.
 * Because the log is append-only, splits and merges are reversible and the
 * originals remain recoverable (spec §8).
 */

export function splitShiftAt(
  shift: Shift,
  at: string,
  deviceId: Id,
  startSeq: number,
): DomainEvent[] {
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
    if (s.reimbursementStatus !== "unclaimed") {
      throw new Error("Cannot merge a shift that has already been submitted.");
    }
  }
  if (!a.endAt || !b.endAt) throw new Error("Cannot merge a shift that is still running.");

  const startAt = Date.parse(a.startAt) < Date.parse(b.startAt) ? a.startAt : b.startAt;
  const endAt = Date.parse(a.endAt) > Date.parse(b.endAt) ? a.endAt : b.endAt;
  const mergedId = newId();

  return [
    makeEvent("shift", mergedId, {
      ...a,
      id: mergedId,
      startAt,
      endAt,
      occurredAt: startAt,
      participants: [...a.participants, ...b.participants],
      isIncident: a.isIncident || b.isIncident,
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
  toShiftId: Id | undefined,
  deviceId: Id,
  startSeq: number,
): DomainEvent[] {
  return [makeEvent("expense", expense.id, { shiftId: toShiftId }, deviceId, startSeq)];
}
