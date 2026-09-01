### Task 12: The Owed query and full backup

**Files:**
- Create: `src/domain/queries.ts`, `src/domain/backup.ts`
- Test: `tests/domain/queries.test.ts`, `tests/domain/backup.test.ts`

**Interfaces:**
- Consumes: `EntityStore`, `live`, `allocateTime`, `Shift`, `Expense`, `Trip`, `Party`.
- Produces:
  - `interface OwedRow { payerPartyId: Id; unclaimed: Money; submitted: Money; paid: Money }`
  - `owedByPayer(store: EntityStore): OwedRow[]`
  - `exportAll(store: EntityStore): string` — pretty-printed JSON of everything

`owedByPayer` is what the Owed screen renders (spec §12). `exportAll` is the safety net that exists because Drive sync comes later (spec §13).

- [ ] **Step 1: Write the failing test**

Create `tests/domain/queries.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { owedByPayer } from "../../src/domain/queries";
import { replay } from "../../src/domain/replay";
import type { DomainEvent } from "../../src/domain/events";

let seq = 0;
function ev(entityType: DomainEvent["entityType"], id: string, fields: Record<string, unknown>): DomainEvent {
  seq += 1;
  return { eventId: `e${seq}`, entityType, entityId: id, fields, recordedAt: `2026-03-0${seq}T00:00:00.000Z`, deviceId: "dev-a", seq };
}

const T = (h: number) => `2026-03-01T${String(h).padStart(2, "0")}:00:00.000Z`;

describe("owedByPayer", () => {
  it("totals unclaimed time and expenses per payer", () => {
    const store = replay([
      ev("shift", "s1", {
        startAt: T(15), endAt: T(18), reimbursementStatus: "unclaimed",
        participants: [{ clientId: "c1", payerPartyId: "p1", inAt: T(15), outAt: T(18), payRate: 3000, timeRule: "fullPerPayer" }],
      }),
      ev("expense", "e1", {
        totalAmount: 3400, reimbursementStatus: "unclaimed",
        splits: [{ clientId: "c1", payerPartyId: "p1", amount: 3400 }],
      }),
    ]);
    const rows = owedByPayer(store);
    expect(rows).toEqual([{ payerPartyId: "p1", unclaimed: 9000 + 3400, submitted: 0, paid: 0 }]);
  });

  it("separates unclaimed, submitted and paid", () => {
    const store = replay([
      ev("expense", "e1", { totalAmount: 1000, reimbursementStatus: "unclaimed", splits: [{ clientId: "c1", payerPartyId: "p1", amount: 1000 }] }),
      ev("expense", "e2", { totalAmount: 2000, reimbursementStatus: "submitted", splits: [{ clientId: "c1", payerPartyId: "p1", amount: 2000 }] }),
      ev("expense", "e3", { totalAmount: 3000, reimbursementStatus: "paid", splits: [{ clientId: "c1", payerPartyId: "p1", amount: 3000 }] }),
    ]);
    expect(owedByPayer(store)).toEqual([{ payerPartyId: "p1", unclaimed: 1000, submitted: 2000, paid: 3000 }]);
  });

  it("keeps payers separate and sorted", () => {
    const store = replay([
      ev("expense", "e1", { totalAmount: 1000, reimbursementStatus: "unclaimed", splits: [{ clientId: "c1", payerPartyId: "pB", amount: 1000 }] }),
      ev("expense", "e2", { totalAmount: 2000, reimbursementStatus: "unclaimed", splits: [{ clientId: "c2", payerPartyId: "pA", amount: 2000 }] }),
    ]);
    expect(owedByPayer(store).map((r) => r.payerPartyId)).toEqual(["pA", "pB"]);
  });

  it("excludes deleted records", () => {
    const store = replay([
      ev("expense", "e1", { totalAmount: 1000, reimbursementStatus: "unclaimed", splits: [{ clientId: "c1", payerPartyId: "p1", amount: 1000 }] }),
      ev("expense", "e1", { deleted: true }),
    ]);
    expect(owedByPayer(store)).toEqual([]);
  });

  it("excludes expenses marked not reimbursable", () => {
    const store = replay([
      ev("expense", "e1", { totalAmount: 1000, reimbursementStatus: "notReimbursable", splits: [{ clientId: "c1", payerPartyId: "p1", amount: 1000 }] }),
    ]);
    expect(owedByPayer(store)).toEqual([]);
  });

  it("returns nothing for an empty store", () => {
    expect(owedByPayer(replay([]))).toEqual([]);
  });
});
```

Create `tests/domain/backup.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { exportAll } from "../../src/domain/backup";
import { replay } from "../../src/domain/replay";
import type { DomainEvent } from "../../src/domain/events";

const clientEvent: DomainEvent = {
  eventId: "e1", entityType: "client", entityId: "c1", fields: { name: "Rory" },
  recordedAt: "2026-03-01T00:00:00.000Z", deviceId: "dev-a", seq: 1,
};

describe("exportAll", () => {
  it("produces parseable JSON containing every entity", () => {
    const json = exportAll(replay([clientEvent]));
    const parsed = JSON.parse(json);
    expect(parsed.client).toEqual([{ id: "c1", name: "Rory" }]);
  });

  it("includes a version and an export timestamp", () => {
    const parsed = JSON.parse(exportAll(replay([])));
    expect(parsed.version).toBe(1);
    expect(parsed.exportedAt).toMatch(/Z$/);
  });

  it("includes deleted records so nothing is lost in a backup", () => {
    const json = exportAll(replay([clientEvent, { ...clientEvent, eventId: "e2", seq: 2, recordedAt: "2026-03-02T00:00:00.000Z", fields: { deleted: true } }]));
    expect(JSON.parse(json).client).toHaveLength(1);
  });

  it("exports an empty store without throwing", () => {
    expect(() => JSON.parse(exportAll(replay([])))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL — cannot resolve `../../src/domain/queries` and `../../src/domain/backup`.

- [ ] **Step 3: Write the implementations**

Create `src/domain/queries.ts`:

```typescript
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
  return null; // notReimbursable is never owed by anyone
}

/** What each payer owes right now, split into unclaimed, waiting, and paid. */
export function owedByPayer(store: EntityStore): OwedRow[] {
  const rows = new Map<Id, OwedRow>();

  const add = (payerPartyId: Id, bucket: Bucket, amount: Money) => {
    const row = rows.get(payerPartyId) ?? { payerPartyId, unclaimed: 0, submitted: 0, paid: 0 };
    row[bucket] += amount;
    rows.set(payerPartyId, row);
  };

  for (const shift of live<Shift>(store, "shift")) {
    const bucket = bucketOf(shift.reimbursementStatus);
    if (!bucket || !shift.endAt) continue;
    for (const claim of allocateTime(shift.participants ?? [])) {
      add(claim.payerPartyId, bucket, claim.amount);
    }
  }

  for (const expense of live<Expense>(store, "expense")) {
    const bucket = bucketOf(expense.reimbursementStatus);
    if (!bucket) continue;
    for (const s of expense.splits ?? []) add(s.payerPartyId, bucket, s.amount);
  }

  for (const trip of live<Trip>(store, "trip")) {
    const bucket = bucketOf(trip.reimbursementStatus);
    if (!bucket || !trip.isClaimable) continue;
    for (const s of trip.splits ?? []) add(s.payerPartyId, bucket, s.claimAmount);
  }

  return [...rows.values()].sort((a, b) => a.payerPartyId.localeCompare(b.payerPartyId));
}
```

Create `src/domain/backup.ts`:

```typescript
import { nowInstant } from "./primitives";
import type { EntityStore } from "./replay";

/**
 * Everything, as JSON, including soft-deleted records. This is the user's
 * escape hatch: they are never locked in and never dependent on this app
 * continuing to exist (spec §13).
 */
export function exportAll(store: EntityStore): string {
  const payload: Record<string, unknown> = {
    version: 1,
    exportedAt: nowInstant(),
  };
  for (const [entityType, records] of Object.entries(store)) {
    payload[entityType] = [...(records as Map<string, unknown>).values()];
  }
  return JSON.stringify(payload, null, 2);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS — the new tests, plus every earlier test still green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add the Owed query and a full JSON backup export"
```

---

## Definition of done

- [ ] `npm test` passes with every test green.
- [ ] `git log --oneline` shows one commit per task.
- [ ] `git ls-files | grep -iE "\.pdf$|^Rory/"` returns **nothing** — no client material was ever committed.
- [ ] `src/domain/` contains no imports of `dexie`, `fetch`, or any DOM global.

## What this plan does not build

The following are Global Constraints of later plans, listed so nobody implements them here:

- Any UI, screen, or component (plan 2).
- Google Drive sync, OAuth, or attachment upload (plan 3).
- PDF and CSV exports, submissions, payments (plan 3+).
- The runaway-timer, overlap and nudge guardrails — these need a UI to surface in (plan 2), though `checkShift` already returns `STILL_RUNNING` for them to build on.
