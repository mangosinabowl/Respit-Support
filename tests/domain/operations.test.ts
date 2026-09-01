import { describe, it, expect } from "vitest";
import { splitShiftAt, mergeShifts, splitExpense, moveExpense } from "../../src/domain/operations";
import { replay } from "../../src/domain/replay";
import type { Shift, Expense } from "../../src/domain/entities";

const T = (h: number) => `2026-03-01T${String(h).padStart(2, "0")}:00:00.000Z`;

const shift: Shift = {
  id: "s1",
  occurredAt: T(15),
  recordedAt: T(15),
  zone: "UTC",
  startAt: T(15),
  endAt: T(18),
  participants: [
    { clientId: "c1", payerPartyId: "p1", inAt: T(15), outAt: T(18), payRate: 3000, timeRule: "fullPerPayer" },
  ],
  isIncident: false,
  reimbursementStatus: "unclaimed",
  tags: [],
  customFields: {},
};

const expense: Expense = {
  id: "e1",
  occurredAt: T(16),
  recordedAt: T(16),
  zone: "UTC",
  totalAmount: 3400,
  category: "food",
  description: "Lunch",
  shiftId: "s1",
  receiptAttachmentIds: ["a1"],
  splits: [{ clientId: "c1", payerPartyId: "p1", amount: 3400 }],
  reimbursementStatus: "unclaimed",
  tags: [],
  customFields: {},
};

describe("splitShiftAt", () => {
  it("produces two shifts covering the original span with no gap", () => {
    const store = replay(splitShiftAt(shift, T(16), "dev-a", 1));
    const shifts = [...store.shift.values()] as unknown as Shift[];
    const live = shifts.filter((s) => !s.deleted);
    expect(live).toHaveLength(2);
    const spans = live.map((s) => [s.startAt, s.endAt]).sort();
    expect(spans).toEqual([[T(15), T(16)], [T(16), T(18)]]);
  });

  it("soft-deletes the original rather than destroying it", () => {
    const store = replay(splitShiftAt(shift, T(16), "dev-a", 1));
    expect(store.shift.get("s1")!.deleted).toBe(true);
  });

  it("clamps each participant to the half they belong in", () => {
    const store = replay(splitShiftAt(shift, T(16), "dev-a", 1));
    const first = ([...store.shift.values()] as unknown as Shift[]).find(
      (s) => !s.deleted && s.startAt === T(15),
    )!;
    expect(first.participants[0].outAt).toBe(T(16));
  });

  it("refuses to split outside the shift window", () => {
    expect(() => splitShiftAt(shift, T(20), "dev-a", 1)).toThrow(/within/i);
  });
});

describe("mergeShifts", () => {
  const second: Shift = { ...shift, id: "s2", startAt: T(18), endAt: T(20), occurredAt: T(18),
    participants: [{ clientId: "c1", payerPartyId: "p1", inAt: T(18), outAt: T(20), payRate: 3000, timeRule: "fullPerPayer" }] };

  it("produces one shift spanning both", () => {
    const store = replay(mergeShifts(shift, second, "dev-a", 1));
    const merged = ([...store.shift.values()] as unknown as Shift[]).find((s) => !s.deleted)!;
    expect([merged.startAt, merged.endAt]).toEqual([T(15), T(20)]);
  });

  it("keeps participants from both, unmerged", () => {
    const store = replay(mergeShifts(shift, second, "dev-a", 1));
    const merged = ([...store.shift.values()] as unknown as Shift[]).find((s) => !s.deleted)!;
    expect(merged.participants).toHaveLength(2);
  });

  it("soft-deletes both originals", () => {
    const store = replay(mergeShifts(shift, second, "dev-a", 1));
    expect(store.shift.get("s1")!.deleted).toBe(true);
    expect(store.shift.get("s2")!.deleted).toBe(true);
  });

  it("refuses to merge a shift that has been submitted", () => {
    const claimed = { ...second, reimbursementStatus: "submitted" as const };
    expect(() => mergeShifts(shift, claimed, "dev-a", 1)).toThrow(/submitted/i);
  });
});

describe("splitExpense", () => {
  it("splits a receipt into parts that still sum to the original", () => {
    const store = replay(
      splitExpense(expense, [
        { description: "Rory's meal", totalAmount: 1200, splits: [{ clientId: "c1", payerPartyId: "p1", amount: 1200 }] },
        { description: "Sam's meal", totalAmount: 2200, splits: [{ clientId: "c2", payerPartyId: "p2", amount: 2200 }] },
      ], "dev-a", 1),
    );
    const parts = ([...store.expense.values()] as unknown as Expense[]).filter((e) => !e.deleted);
    expect(parts.reduce((t, e) => t + e.totalAmount, 0)).toBe(3400);
  });

  it("keeps the receipt image on every part", () => {
    const store = replay(
      splitExpense(expense, [
        { description: "a", totalAmount: 1700, splits: [{ clientId: "c1", payerPartyId: "p1", amount: 1700 }] },
        { description: "b", totalAmount: 1700, splits: [{ clientId: "c2", payerPartyId: "p2", amount: 1700 }] },
      ], "dev-a", 1),
    );
    const parts = ([...store.expense.values()] as unknown as Expense[]).filter((e) => !e.deleted);
    expect(parts.every((e) => e.receiptAttachmentIds.includes("a1"))).toBe(true);
  });

  it("refuses parts that do not sum to the original total", () => {
    expect(() =>
      splitExpense(expense, [{ description: "a", totalAmount: 1000, splits: [] }], "dev-a", 1),
    ).toThrow(/sum/i);
  });
});

describe("moveExpense", () => {
  it("reassigns the expense to another shift", () => {
    const store = replay(moveExpense(expense, "s2", "dev-a", 1));
    expect((store.expense.get("e1") as unknown as Expense).shiftId).toBe("s2");
  });

  it("detaches the expense when moved to no shift", () => {
    const store = replay(moveExpense(expense, undefined, "dev-a", 1));
    expect((store.expense.get("e1") as unknown as Expense).shiftId).toBeUndefined();
  });
});
