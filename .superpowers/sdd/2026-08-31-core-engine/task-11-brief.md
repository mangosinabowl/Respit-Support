### Task 11: Split, merge, and move

**Files:**
- Create: `src/domain/operations.ts`
- Test: `tests/domain/operations.test.ts`

**Interfaces:**
- Consumes: `DomainEvent`, `makeEvent`, `Shift`, `Expense`, `MoneySplit`, `allocateEvenly`.
- Produces (each returns the events to append, never mutating input — spec §8):
  - `splitShiftAt(shift, at, deviceId, startSeq): DomainEvent[]`
  - `mergeShifts(a, b, deviceId, startSeq): DomainEvent[]`
  - `splitExpense(expense, parts, deviceId, startSeq): DomainEvent[]`
  - `moveExpense(expense, toShiftId, deviceId, startSeq): DomainEvent[]`

- [ ] **Step 1: Write the failing test**

Create `tests/domain/operations.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../../src/domain/operations`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/operations.ts`:

```typescript
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — the new tests, plus every earlier test still green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add reversible split, merge and move operations"
```

---

