### Task 5: Time segments and support ratios

**Files:**
- Create: `src/domain/segments.ts`
- Test: `tests/domain/segments.test.ts`

**Interfaces:**
- Consumes: `Participant`, `ISOInstant`, `minutesBetween`.
- Produces:
  - `interface Segment { from: ISOInstant; to: ISOInstant; clientIds: Id[]; minutes: number }`
  - `segmentsFor(participants: Participant[]): Segment[]`

Participants arrive and leave at different times (spec §5.1). This splits a shift into stretches where the set of people present is constant — which is what makes both the displayed ratio and even-splitting correct.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/segments.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { segmentsFor } from "../../src/domain/segments";
import type { Participant } from "../../src/domain/entities";

function p(clientId: string, inAt: string, outAt: string): Participant {
  return {
    clientId,
    payerPartyId: `payer-${clientId}`,
    inAt,
    outAt,
    payRate: 2500,
    timeRule: "fullPerPayer",
  };
}

const T = (h: number) => `2026-03-01T${String(h).padStart(2, "0")}:00:00.000Z`;

describe("segmentsFor", () => {
  it("returns one segment for a single participant", () => {
    const segs = segmentsFor([p("c1", T(15), T(18))]);
    expect(segs).toEqual([{ from: T(15), to: T(18), clientIds: ["c1"], minutes: 180 }]);
  });

  it("splits a staggered shift into 1:1, 1:2, 1:1", () => {
    const segs = segmentsFor([p("c1", T(15), T(18)), p("c2", T(16), T(17))]);
    expect(segs).toEqual([
      { from: T(15), to: T(16), clientIds: ["c1"], minutes: 60 },
      { from: T(16), to: T(17), clientIds: ["c1", "c2"], minutes: 60 },
      { from: T(17), to: T(18), clientIds: ["c1"], minutes: 60 },
    ]);
  });

  it("handles identical times as one shared segment", () => {
    const segs = segmentsFor([p("c1", T(15), T(18)), p("c2", T(15), T(18))]);
    expect(segs).toHaveLength(1);
    expect(segs[0].clientIds).toEqual(["c1", "c2"]);
  });

  it("omits gaps when participants do not overlap at all", () => {
    const segs = segmentsFor([p("c1", T(15), T(16)), p("c2", T(17), T(18))]);
    expect(segs).toEqual([
      { from: T(15), to: T(16), clientIds: ["c1"], minutes: 60 },
      { from: T(17), to: T(18), clientIds: ["c2"], minutes: 60 },
    ]);
  });

  it("returns no segments for no participants", () => {
    expect(segmentsFor([])).toEqual([]);
  });

  it("ignores a participant whose out time equals their in time", () => {
    const segs = segmentsFor([p("c1", T(15), T(18)), p("c2", T(16), T(16))]);
    expect(segs).toEqual([{ from: T(15), to: T(18), clientIds: ["c1"], minutes: 180 }]);
  });

  it("sorts client ids within a segment for deterministic output", () => {
    const segs = segmentsFor([p("z1", T(15), T(18)), p("a1", T(15), T(18))]);
    expect(segs[0].clientIds).toEqual(["a1", "z1"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../../src/domain/segments`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/segments.ts`:

```typescript
import { minutesBetween, type Id, type ISOInstant } from "./primitives";
import type { Participant } from "./entities";

/** A stretch of time during which the set of people present does not change. */
export interface Segment {
  from: ISOInstant;
  to: ISOInstant;
  clientIds: Id[];
  minutes: number;
}

/**
 * Splits a shift into constant-attendance segments. Boundaries are every
 * in-time and out-time; a segment with nobody present is dropped, so gaps
 * between non-overlapping participants do not appear.
 */
export function segmentsFor(participants: Participant[]): Segment[] {
  const present = participants.filter((p) => Date.parse(p.outAt) > Date.parse(p.inAt));
  if (present.length === 0) return [];

  const boundaries = [
    ...new Set(present.flatMap((p) => [p.inAt, p.outAt])),
  ].sort((a, b) => Date.parse(a) - Date.parse(b));

  const segments: Segment[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const from = boundaries[i];
    const to = boundaries[i + 1];
    const clientIds = present
      .filter((p) => Date.parse(p.inAt) <= Date.parse(from) && Date.parse(p.outAt) >= Date.parse(to))
      .map((p) => p.clientId)
      .sort();
    if (clientIds.length === 0) continue;
    segments.push({ from, to, clientIds, minutes: minutesBetween(from, to) });
  }
  return segments;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — the new tests, plus every earlier test still green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: derive constant-attendance time segments from staggered participants"
```

---

