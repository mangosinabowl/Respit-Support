### Task 6: Money allocation with an exact-sum guarantee

**Files:**
- Create: `src/domain/allocation.ts`
- Test: `tests/domain/allocation.test.ts`

**Interfaces:**
- Consumes: `Money`, `Id`, `MoneySplit`.
- Produces:
  - `interface Payee { clientId: Id; payerPartyId: Id }`
  - `allocateEvenly(total: Money, payees: Payee[]): MoneySplit[]`
  - `allocateByWeights(total: Money, payees: Payee[], weights: number[]): MoneySplit[]`

The exact-sum guarantee from the Global Constraints is enforced here. $34.00 across three people is 1134 + 1133 + 1133, not three times 11.33 rounded.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/allocation.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { allocateEvenly, allocateByWeights, type Payee } from "../../src/domain/allocation";

const payees: Payee[] = [
  { clientId: "c1", payerPartyId: "p1" },
  { clientId: "c2", payerPartyId: "p2" },
  { clientId: "c3", payerPartyId: "p2" },
];

describe("allocateEvenly", () => {
  it("splits an exactly divisible amount equally", () => {
    const splits = allocateEvenly(3000, payees);
    expect(splits.map((s) => s.amount)).toEqual([1000, 1000, 1000]);
  });

  it("distributes an indivisible remainder without losing a cent", () => {
    const splits = allocateEvenly(3400, payees);
    expect(splits.map((s) => s.amount)).toEqual([1134, 1133, 1133]);
    expect(splits.reduce((t, s) => t + s.amount, 0)).toBe(3400);
  });

  it("never loses or invents a cent, for any total or party count", () => {
    for (let total = 0; total <= 500; total++) {
      for (let n = 1; n <= 7; n++) {
        const some = Array.from({ length: n }, (_, i) => ({
          clientId: `c${i}`,
          payerPartyId: `p${i}`,
        }));
        const sum = allocateEvenly(total, some).reduce((t, s) => t + s.amount, 0);
        expect(sum).toBe(total);
      }
    }
  });

  it("is deterministic: the same input always gives the same output", () => {
    expect(allocateEvenly(3400, payees)).toEqual(allocateEvenly(3400, payees));
  });

  it("returns no splits when there are no payees", () => {
    expect(allocateEvenly(3400, [])).toEqual([]);
  });

  it("preserves each payee's client and payer", () => {
    const splits = allocateEvenly(3000, payees);
    expect(splits[2]).toEqual({ clientId: "c3", payerPartyId: "p2", amount: 1000 });
  });
});

describe("allocateByWeights", () => {
  it("splits in proportion to the weights", () => {
    const splits = allocateByWeights(4000, payees, [2, 1, 1]);
    expect(splits.map((s) => s.amount)).toEqual([2000, 1000, 1000]);
  });

  it("still sums exactly when weights divide unevenly", () => {
    const splits = allocateByWeights(1000, payees, [1, 1, 1]);
    expect(splits.reduce((t, s) => t + s.amount, 0)).toBe(1000);
  });

  it("falls back to an even split when all weights are zero", () => {
    const splits = allocateByWeights(3000, payees, [0, 0, 0]);
    expect(splits.map((s) => s.amount)).toEqual([1000, 1000, 1000]);
  });

  it("throws when weights do not match payees", () => {
    expect(() => allocateByWeights(3000, payees, [1, 1])).toThrow(/weights/i);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../../src/domain/allocation`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/allocation.ts`:

```typescript
import type { Id, Money } from "./primitives";
import type { MoneySplit } from "./entities";

export interface Payee {
  clientId: Id;
  payerPartyId: Id;
}

/**
 * Splits `total` as evenly as integer cents allow. Any remainder is handed
 * out one cent at a time from the front, so the parts always sum exactly
 * back to the total (Global Constraints; spec §5).
 */
export function allocateEvenly(total: Money, payees: Payee[]): MoneySplit[] {
  return allocateByWeights(total, payees, payees.map(() => 1));
}

/**
 * Splits `total` in proportion to `weights`. Uses largest-remainder
 * apportionment so the parts sum exactly to the total with no drift.
 */
export function allocateByWeights(
  total: Money,
  payees: Payee[],
  weights: number[],
): MoneySplit[] {
  if (weights.length !== payees.length) {
    throw new Error("allocateByWeights: weights must match payees in length");
  }
  if (payees.length === 0) return [];

  const totalWeight = weights.reduce((t, w) => t + w, 0);
  const effective = totalWeight === 0 ? payees.map(() => 1) : weights;
  const effectiveTotal = effective.reduce((t, w) => t + w, 0);

  const exact = effective.map((w) => (total * w) / effectiveTotal);
  const floors = exact.map(Math.floor);
  let remainder = total - floors.reduce((t, f) => t + f, 0);

  // Largest fractional part first; index breaks ties so output is deterministic.
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);

  const amounts = [...floors];
  for (const { index } of order) {
    if (remainder <= 0) break;
    amounts[index] += 1;
    remainder -= 1;
  }

  return payees.map((p, i) => ({
    clientId: p.clientId,
    payerPartyId: p.payerPartyId,
    amount: amounts[i],
  }));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — the new tests, plus every earlier test still green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add allocation engine with exact-sum guarantee"
```

---

