### Task 7: Time allocation rules

**Files:**
- Create: `src/domain/timeAllocation.ts`
- Test: `tests/domain/timeAllocation.test.ts`

**Interfaces:**
- Consumes: `Participant`, `segmentsFor`, `minutesBetween`.
- Produces:
  - `interface TimeClaim { clientId: Id; payerPartyId: Id; minutes: number; amount: Money }`
  - `allocateTime(participants: Participant[]): TimeClaim[]`

The user's decision, recorded in spec §5.1: **more children means more pay, never a group discount.** `fullPerPayer` is the default and every payer owes the full duration their client was present. `splitEvenly` exists as an opt-in preset.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/timeAllocation.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { allocateTime } from "../../src/domain/timeAllocation";
import type { Participant, TimeRule } from "../../src/domain/entities";

const T = (h: number) => `2026-03-01T${String(h).padStart(2, "0")}:00:00.000Z`;

function p(clientId: string, inAt: string, outAt: string, timeRule: TimeRule = "fullPerPayer"): Participant {
  return { clientId, payerPartyId: `payer-${clientId}`, inAt, outAt, payRate: 3000, timeRule };
}

describe("allocateTime", () => {
  it("bills a single participant their full duration", () => {
    const claims = allocateTime([p("c1", T(15), T(18))]);
    expect(claims).toEqual([
      { clientId: "c1", payerPartyId: "payer-c1", minutes: 180, amount: 9000 },
    ]);
  });

  it("bills every payer the full duration when grouped (no group discount)", () => {
    const claims = allocateTime([p("c1", T(15), T(18)), p("c2", T(15), T(18))]);
    expect(claims.map((c) => c.minutes)).toEqual([180, 180]);
    expect(claims.map((c) => c.amount)).toEqual([9000, 9000]);
  });

  it("bills each payer only for the time their own client was present", () => {
    const claims = allocateTime([p("c1", T(15), T(18)), p("c2", T(16), T(17))]);
    expect(claims.find((c) => c.clientId === "c1")!.minutes).toBe(180);
    expect(claims.find((c) => c.clientId === "c2")!.minutes).toBe(60);
  });

  it("divides shared time when a participant opts into splitEvenly", () => {
    const claims = allocateTime([
      p("c1", T(15), T(18), "splitEvenly"),
      p("c2", T(16), T(17), "splitEvenly"),
    ]);
    // c1: 60 alone + 30 of the shared hour + 60 alone = 150
    expect(claims.find((c) => c.clientId === "c1")!.minutes).toBe(150);
    // c2: 30 of the shared hour
    expect(claims.find((c) => c.clientId === "c2")!.minutes).toBe(30);
  });

  it("lets rules differ per participant on the same shift", () => {
    const claims = allocateTime([
      p("c1", T(15), T(17), "fullPerPayer"),
      p("c2", T(15), T(17), "splitEvenly"),
    ]);
    expect(claims.find((c) => c.clientId === "c1")!.minutes).toBe(120);
    expect(claims.find((c) => c.clientId === "c2")!.minutes).toBe(60);
  });

  it("uses each participant's own snapshotted rate", () => {
    const a = { ...p("c1", T(15), T(16)), payRate: 2000 };
    const b = { ...p("c2", T(15), T(16)), payRate: 4000 };
    const claims = allocateTime([a, b]);
    expect(claims.find((c) => c.clientId === "c1")!.amount).toBe(2000);
    expect(claims.find((c) => c.clientId === "c2")!.amount).toBe(4000);
  });

  it("returns nothing for no participants", () => {
    expect(allocateTime([])).toEqual([]);
  });

  it("returns nothing for a participant with zero duration", () => {
    expect(allocateTime([p("c1", T(15), T(15))])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../../src/domain/timeAllocation`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/timeAllocation.ts`:

```typescript
import { minutesBetween, type Id, type Money } from "./primitives";
import type { Participant } from "./entities";
import { segmentsFor } from "./segments";

export interface TimeClaim {
  clientId: Id;
  payerPartyId: Id;
  minutes: number;
  /** minutes / 60 * payRate, rounded to the nearest cent. */
  amount: Money;
}

/**
 * Turns participants into per-payer time claims.
 *
 * `fullPerPayer` (the default): a payer owes the full duration their own
 * client was present, regardless of who else was there. More children means
 * more pay, never a group discount (spec §5.1).
 *
 * `splitEvenly`: shared stretches are divided among everyone present during
 * that stretch, so total billed time never exceeds time actually worked.
 */
export function allocateTime(participants: Participant[]): TimeClaim[] {
  const present = participants.filter((p) => Date.parse(p.outAt) > Date.parse(p.inAt));
  if (present.length === 0) return [];

  const segments = segmentsFor(present);
  const minutesByClient = new Map<Id, number>();

  for (const p of present) {
    if (p.timeRule === "fullPerPayer") {
      minutesByClient.set(p.clientId, minutesBetween(p.inAt, p.outAt));
    }
  }

  for (const seg of segments) {
    const sharing = seg.clientIds.filter(
      (id) => present.find((p) => p.clientId === id)!.timeRule === "splitEvenly",
    );
    if (sharing.length === 0) continue;
    const each = seg.minutes / seg.clientIds.length;
    for (const id of sharing) {
      minutesByClient.set(id, (minutesByClient.get(id) ?? 0) + each);
    }
  }

  return present.map((p) => {
    const minutes = Math.round(minutesByClient.get(p.clientId) ?? 0);
    return {
      clientId: p.clientId,
      payerPartyId: p.payerPartyId,
      minutes,
      amount: Math.round((minutes / 60) * p.payRate),
    };
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — the new tests, plus every earlier test still green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: allocate shift time per payer, defaulting to no group discount"
```

---

