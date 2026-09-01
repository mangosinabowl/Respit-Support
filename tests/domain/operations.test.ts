import { describe, it, expect } from "vitest";
import { splitShiftAt, mergeShifts, splitExpense, moveExpense } from "../../src/domain/operations";
import { replay } from "../../src/domain/replay";
import type { DomainEvent } from "../../src/domain/events";
import { minutesBetween } from "../../src/domain/primitives";
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

  it("clamps the second half's participant inAt to the split point (M05)", () => {
    const store = replay(splitShiftAt(shift, T(16), "dev-a", 1));
    const second = ([...store.shift.values()] as unknown as Shift[]).find(
      (s) => !s.deleted && s.startAt === T(16),
    )!;
    expect(second.participants[0].inAt).toBe(T(16));
  });

  it("refuses to split outside the shift window", () => {
    expect(() => splitShiftAt(shift, T(20), "dev-a", 1)).toThrow(/within/i);
  });

  it("refuses to split a shift that is still running (M01)", () => {
    const running: Shift = { ...shift, endAt: null };
    expect(() => splitShiftAt(running, T(16), "dev-a", 1)).toThrow(/running/i);
  });

  it("refuses to split a shift that has already been submitted", () => {
    const submitted: Shift = { ...shift, reimbursementStatus: "submitted" };
    expect(() => splitShiftAt(submitted, T(16), "dev-a", 1)).toThrow(/submitted/i);
  });

  it("refuses to split a shift that has been paid, naming the actual status", () => {
    const paid: Shift = { ...shift, reimbursementStatus: "paid" };
    expect(() => splitShiftAt(paid, T(16), "dev-a", 1)).toThrow(/paid/i);
  });

  it("keeps the original pay rate and time rule on both halves, never recomputed (M12)", () => {
    const store = replay(splitShiftAt(shift, T(16), "dev-a", 1));
    const halves = ([...store.shift.values()] as unknown as Shift[]).filter((s) => !s.deleted);
    expect(halves).toHaveLength(2);
    for (const half of halves) {
      expect(half.participants[0].payRate).toBe(3000);
      expect(half.participants[0].timeRule).toBe("fullPerPayer");
    }
  });

  describe("input validation (Critical 2)", () => {
    it("refuses an unparseable split point ('not-a-date') without emitting any events", () => {
      expect(() => splitShiftAt(shift, "not-a-date", "dev-a", 1)).toThrow(/valid instant/i);
    });

    it("refuses an empty split point ('') without emitting any events", () => {
      expect(() => splitShiftAt(shift, "", "dev-a", 1)).toThrow(/valid instant/i);
    });

    it("refuses an out-of-range split point ('2026-13-45T99:00:00Z') without emitting any events", () => {
      expect(() => splitShiftAt(shift, "2026-13-45T99:00:00Z", "dev-a", 1)).toThrow(/valid instant/i);
    });
  });
});

describe("mergeShifts", () => {
  // Distinct client/payer from `shift`'s c1/p1: this fixture exercises the
  // "two different people, adjacent shifts" case, which must stay unmerged.
  // (Originally this reused c1/p1, which meant the fixture never actually
  // tested the thing its title claimed — see Critical 1 in the fix report.)
  const second: Shift = { ...shift, id: "s2", startAt: T(18), endAt: T(20), occurredAt: T(18),
    participants: [{ clientId: "c2", payerPartyId: "p2", inAt: T(18), outAt: T(20), payRate: 3000, timeRule: "fullPerPayer" }] };

  it("produces one shift spanning both", () => {
    const store = replay(mergeShifts(shift, second, "dev-a", 1));
    const merged = ([...store.shift.values()] as unknown as Shift[]).find((s) => !s.deleted)!;
    expect([merged.startAt, merged.endAt]).toEqual([T(15), T(20)]);
  });

  it("keeps participants from both, unmerged, when they are different people", () => {
    const store = replay(mergeShifts(shift, second, "dev-a", 1));
    const merged = ([...store.shift.values()] as unknown as Shift[]).find((s) => !s.deleted)!;
    expect(merged.participants).toHaveLength(2);
  });

  it("bills the distinct-client adjacent case for the same total minutes as before (300)", () => {
    const store = replay(mergeShifts(shift, second, "dev-a", 1));
    const merged = ([...store.shift.values()] as unknown as Shift[]).find((s) => !s.deleted)!;
    const totalMinutes = merged.participants.reduce((t, p) => t + minutesBetween(p.inAt, p.outAt), 0);
    expect(totalMinutes).toBe(300);
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

  it("refuses to merge a shift that has been paid, naming the actual status (not hardcoded 'submitted')", () => {
    const claimed = { ...second, reimbursementStatus: "paid" as const };
    expect(() => mergeShifts(shift, claimed, "dev-a", 1)).toThrow(/paid/i);
  });

  it("refuses to merge a shift that is still running (M15)", () => {
    const running: Shift = { ...second, endAt: null };
    expect(() => mergeShifts(shift, running, "dev-a", 1)).toThrow(/running/i);
  });

  describe("participant union (Critical 1 — double-billing)", () => {
    it("unions a duplicate participant pair (same client, identical span) into one row", () => {
      const a: Shift = { ...shift }; // c1/p1, 15-18
      const b: Shift = { ...shift, id: "sDup", occurredAt: T(15) }; // exact duplicate: c1/p1, 15-18
      const store = replay(mergeShifts(a, b, "dev-a", 1));
      const merged = ([...store.shift.values()] as unknown as Shift[]).find((s) => !s.deleted)!;
      expect(merged.participants).toHaveLength(1);
      expect(merged.participants[0].inAt).toBe(T(15));
      expect(merged.participants[0].outAt).toBe(T(18));
      expect(minutesBetween(merged.participants[0].inAt, merged.participants[0].outAt)).toBe(180);
    });

    it("unions an overlapping participant pair (same client) spanning earliest-to-latest", () => {
      const a: Shift = { ...shift }; // c1/p1, 15-18
      const b: Shift = {
        ...shift,
        id: "sOverlap",
        startAt: T(16),
        endAt: T(19),
        occurredAt: T(16),
        participants: [{ clientId: "c1", payerPartyId: "p1", inAt: T(16), outAt: T(19), payRate: 3000, timeRule: "fullPerPayer" }],
      };
      const store = replay(mergeShifts(a, b, "dev-a", 1));
      const merged = ([...store.shift.values()] as unknown as Shift[]).find((s) => !s.deleted)!;
      expect(merged.participants).toHaveLength(1);
      expect(merged.participants[0].inAt).toBe(T(15));
      expect(merged.participants[0].outAt).toBe(T(19));
      expect(minutesBetween(merged.participants[0].inAt, merged.participants[0].outAt)).toBe(240);
    });

    it("refuses to merge when the same client has a different pay rate in each shift, naming the client", () => {
      const a: Shift = { ...shift }; // c1/p1 @ 3000
      const b: Shift = {
        ...shift,
        id: "sRateConflict",
        startAt: T(18),
        endAt: T(20),
        occurredAt: T(18),
        participants: [{ clientId: "c1", payerPartyId: "p1", inAt: T(18), outAt: T(20), payRate: 3500, timeRule: "fullPerPayer" }],
      };
      expect(() => mergeShifts(a, b, "dev-a", 1)).toThrow(/c1/);
    });

    it("refuses to merge when the same client has a different time rule in each shift, naming the client", () => {
      const a: Shift = { ...shift }; // c1/p1 fullPerPayer
      const b: Shift = {
        ...shift,
        id: "sRuleConflict",
        startAt: T(18),
        endAt: T(20),
        occurredAt: T(18),
        participants: [{ clientId: "c1", payerPartyId: "p1", inAt: T(18), outAt: T(20), payRate: 3000, timeRule: "splitEvenly" }],
      };
      expect(() => mergeShifts(a, b, "dev-a", 1)).toThrow(/c1/);
    });
  });

  describe("tags and customFields (Also fix)", () => {
    it("unions tags and merges customFields, with a's values winning on conflict; zone stays a's", () => {
      const a: Shift = { ...shift, zone: "America/New_York", tags: ["t1", "shared"], customFields: { note: "from-a", onlyA: "x" } };
      const b: Shift = {
        ...second,
        zone: "America/Los_Angeles",
        tags: ["t2", "shared"],
        customFields: { note: "from-b", onlyB: "y" },
      };
      const store = replay(mergeShifts(a, b, "dev-a", 1));
      const merged = ([...store.shift.values()] as unknown as Shift[]).find((s) => !s.deleted)!;
      expect(new Set(merged.tags)).toEqual(new Set(["t1", "t2", "shared"]));
      expect(merged.customFields).toEqual({ note: "from-a", onlyA: "x", onlyB: "y" });
      expect(merged.zone).toBe("America/New_York"); // a's zone; see report re: known limitation
    });
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

  it("gives each part its own splits, not the original expense's (M27)", () => {
    const store = replay(
      splitExpense(expense, [
        { description: "Rory's meal", totalAmount: 1200, splits: [{ clientId: "c1", payerPartyId: "p1", amount: 1200 }] },
        { description: "Sam's meal", totalAmount: 2200, splits: [{ clientId: "c2", payerPartyId: "p2", amount: 2200 }] },
      ], "dev-a", 1),
    );
    const parts = ([...store.expense.values()] as unknown as Expense[]).filter((e) => !e.deleted);
    const rory = parts.find((p) => p.description === "Rory's meal")!;
    const sam = parts.find((p) => p.description === "Sam's meal")!;
    expect(rory.splits).toEqual([{ clientId: "c1", payerPartyId: "p1", amount: 1200 }]);
    expect(sam.splits).toEqual([{ clientId: "c2", payerPartyId: "p2", amount: 2200 }]);
  });

  it("does not leave the original expense live and double-counted after a split (M29)", () => {
    // Seed the original into the store first, as replay would see it in real
    // use (created by an earlier event long before the split). Without this
    // seed, a mutant that drops the final delete-event is invisible: the
    // store never had "e1" in it to begin with, so there's nothing to
    // wrongly leave live.
    const seed: DomainEvent = {
      eventId: "seed-e1",
      entityType: "expense",
      entityId: expense.id,
      fields: { ...expense },
      recordedAt: "2000-01-01T00:00:00.000Z",
      deviceId: "seed",
      seq: 0,
    };
    const store = replay([
      seed,
      ...splitExpense(expense, [
        { description: "Rory's meal", totalAmount: 1200, splits: [{ clientId: "c1", payerPartyId: "p1", amount: 1200 }] },
        { description: "Sam's meal", totalAmount: 2200, splits: [{ clientId: "c2", payerPartyId: "p2", amount: 2200 }] },
      ], "dev-a", 1),
    ]);
    expect(store.expense.get("e1")!.deleted).toBe(true);
    const live = ([...store.expense.values()] as unknown as Expense[]).filter((e) => !e.deleted);
    expect(live.reduce((t, e) => t + e.totalAmount, 0)).toBe(3400);
  });

  it("refuses parts that do not sum to the original total", () => {
    expect(() =>
      splitExpense(expense, [{ description: "a", totalAmount: 1000, splits: [] }], "dev-a", 1),
    ).toThrow(/sum/i);
  });

  it("refuses to split an expense that isn't unclaimed", () => {
    const paid: Expense = { ...expense, reimbursementStatus: "paid" };
    expect(() =>
      splitExpense(paid, [{ description: "a", totalAmount: 3400, splits: [] }], "dev-a", 1),
    ).toThrow(/paid/i);
  });
});

describe("moveExpense", () => {
  it("reassigns the expense to another shift", () => {
    const store = replay(moveExpense(expense, "s2", "dev-a", 1));
    expect((store.expense.get("e1") as unknown as Expense).shiftId).toBe("s2");
  });

  it("detaches the expense when moved to no shift, clearing with null rather than undefined (Critical 3)", () => {
    const store = replay(moveExpense(expense, undefined, "dev-a", 1));
    expect((store.expense.get("e1") as unknown as Expense).shiftId).toBeNull();
  });

  it("survives a JSON round-trip when clearing shiftId, unlike undefined", () => {
    const [event] = moveExpense(expense, undefined, "dev-a", 1);
    const roundTripped = JSON.parse(JSON.stringify(event)) as DomainEvent;
    expect(roundTripped.fields.shiftId).toBeNull();
    const store = replay([roundTripped]);
    expect((store.expense.get("e1") as unknown as Expense).shiftId).toBeNull();
  });

  it("refuses to move an expense that isn't unclaimed", () => {
    const paid: Expense = { ...expense, reimbursementStatus: "paid" };
    expect(() => moveExpense(paid, "s2", "dev-a", 1)).toThrow(/paid/i);
  });
});

describe("sequence number contiguity (M10 / M30 / M31)", () => {
  const seqsOf = (events: { seq: number }[]) => events.map((e) => e.seq);

  it("splitShiftAt reserves a contiguous 3-slot block starting at startSeq", () => {
    expect(seqsOf(splitShiftAt(shift, T(16), "dev-a", 7))).toEqual([7, 8, 9]);
  });

  it("mergeShifts reserves a contiguous 3-slot block starting at startSeq", () => {
    const second: Shift = { ...shift, id: "s2", startAt: T(18), endAt: T(20), occurredAt: T(18),
      participants: [{ clientId: "c2", payerPartyId: "p2", inAt: T(18), outAt: T(20), payRate: 3000, timeRule: "fullPerPayer" }] };
    expect(seqsOf(mergeShifts(shift, second, "dev-a", 7))).toEqual([7, 8, 9]);
  });

  it("splitExpense reserves a contiguous (parts+1)-slot block starting at startSeq", () => {
    const events = splitExpense(expense, [
      { description: "a", totalAmount: 1700, splits: [] },
      { description: "b", totalAmount: 1700, splits: [] },
    ], "dev-a", 7);
    expect(seqsOf(events)).toEqual([7, 8, 9]);
  });

  it("splitExpense reserves 4 slots for 3 parts starting at startSeq", () => {
    const events = splitExpense(expense, [
      { description: "a", totalAmount: 1000, splits: [] },
      { description: "b", totalAmount: 1000, splits: [] },
      { description: "c", totalAmount: 1400, splits: [] },
    ], "dev-a", 7);
    expect(seqsOf(events)).toEqual([7, 8, 9, 10]);
  });

  it("moveExpense reserves a single slot at startSeq", () => {
    expect(seqsOf(moveExpense(expense, "s2", "dev-a", 7))).toEqual([7]);
  });
});
