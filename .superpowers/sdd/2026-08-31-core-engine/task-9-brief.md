### Task 9: Audience filtering

**Files:**
- Create: `src/domain/audience.ts`
- Test: `tests/domain/audience.test.ts`

**Interfaces:**
- Consumes: `EntityStore`, `live`, `Shift`, `Expense`, `Note`, `ClientPartyRole`.
- Produces:
  - `type Audience = "me" | "payer" | "guardian"`
  - `interface AudienceContext { audience: Audience; partyId?: Id }`
  - `clientsVisibleTo(store, ctx): Id[]`
  - `filterShiftFor(shift, ctx, visibleClients): Shift | null`
  - `filterExpenseFor(expense, ctx, visibleClients): Expense | null`
  - `filterNotesFor(notes, ctx): Note[]`

**This is the highest-severity area in the codebase.** Spec §7.1: a payer's or guardian's view must never disclose that another payer's or another family's client exists. Filtering *selects* records for the audience; it never takes the full view and hides parts of it.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/audience.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import {
  clientsVisibleTo,
  filterShiftFor,
  filterExpenseFor,
  filterNotesFor,
  type AudienceContext,
} from "../../src/domain/audience";
import { replay } from "../../src/domain/replay";
import type { DomainEvent } from "../../src/domain/events";
import type { Shift, Expense, Note } from "../../src/domain/entities";

function roleEvent(id: string, clientId: string, partyId: string, role: string): DomainEvent {
  return {
    eventId: id,
    entityType: "role",
    entityId: id,
    fields: { clientId, partyId, role },
    recordedAt: "2026-01-01T00:00:00.000Z",
    deviceId: "dev-a",
    seq: 1,
  };
}

// Agency A pays for Rory. A family pays for Sam. A grandmother is Rory's guardian.
const store = replay([
  roleEvent("r1", "rory", "agencyA", "payer"),
  roleEvent("r2", "sam", "familyB", "payer"),
  roleEvent("r3", "rory", "gran", "guardian"),
]);

const mixedShift: Shift = {
  id: "s1",
  occurredAt: "2026-03-01T22:00:00.000Z",
  recordedAt: "2026-03-01T22:00:00.000Z",
  zone: "UTC",
  startAt: "2026-03-01T22:00:00.000Z",
  endAt: "2026-03-02T01:00:00.000Z",
  participants: [
    { clientId: "rory", payerPartyId: "agencyA", inAt: "2026-03-01T22:00:00.000Z", outAt: "2026-03-02T01:00:00.000Z", payRate: 3000, timeRule: "fullPerPayer" },
    { clientId: "sam", payerPartyId: "familyB", inAt: "2026-03-01T22:00:00.000Z", outAt: "2026-03-02T01:00:00.000Z", payRate: 2500, timeRule: "fullPerPayer" },
  ],
  isIncident: false,
  reimbursementStatus: "unclaimed",
  tags: [],
  customFields: {},
};

describe("clientsVisibleTo", () => {
  it("shows every client to me", () => {
    expect(clientsVisibleTo(store, { audience: "me" }).sort()).toEqual(["rory", "sam"]);
  });

  it("shows a payer only the clients they pay for", () => {
    expect(clientsVisibleTo(store, { audience: "payer", partyId: "agencyA" })).toEqual(["rory"]);
  });

  it("shows a guardian only their own child", () => {
    expect(clientsVisibleTo(store, { audience: "guardian", partyId: "gran" })).toEqual(["rory"]);
  });

  it("shows nothing to a party with no roles", () => {
    expect(clientsVisibleTo(store, { audience: "payer", partyId: "stranger" })).toEqual([]);
  });
});

describe("filterShiftFor", () => {
  const ctx: AudienceContext = { audience: "payer", partyId: "agencyA" };

  it("removes other payers' participants entirely", () => {
    const filtered = filterShiftFor(mixedShift, ctx, ["rory"])!;
    expect(filtered.participants).toHaveLength(1);
    expect(filtered.participants[0].clientId).toBe("rory");
  });

  it("leaks no trace of the other client anywhere in the output", () => {
    const filtered = filterShiftFor(mixedShift, ctx, ["rory"])!;
    expect(JSON.stringify(filtered)).not.toContain("sam");
    expect(JSON.stringify(filtered)).not.toContain("familyB");
  });

  it("returns null when the audience has no participant on the shift", () => {
    expect(filterShiftFor(mixedShift, { audience: "payer", partyId: "stranger" }, [])).toBeNull();
  });

  it("returns the shift untouched for me", () => {
    expect(filterShiftFor(mixedShift, { audience: "me" }, ["rory", "sam"])).toEqual(mixedShift);
  });

  it("strips pay rates from a guardian's view", () => {
    const filtered = filterShiftFor(mixedShift, { audience: "guardian", partyId: "gran" }, ["rory"])!;
    expect(filtered.participants[0]).not.toHaveProperty("payRate");
  });
});

describe("filterExpenseFor", () => {
  const lunch: Expense = {
    id: "e1",
    occurredAt: "2026-03-01T23:00:00.000Z",
    recordedAt: "2026-03-01T23:00:00.000Z",
    zone: "UTC",
    totalAmount: 3400,
    category: "food",
    description: "Lunch",
    receiptAttachmentIds: ["a1"],
    splits: [
      { clientId: "rory", payerPartyId: "agencyA", amount: 1700 },
      { clientId: "sam", payerPartyId: "familyB", amount: 1700 },
    ],
    reimbursementStatus: "unclaimed",
    tags: [],
    customFields: {},
  };

  it("shows a payer only their own split and restates the total as their share", () => {
    const filtered = filterExpenseFor(lunch, { audience: "payer", partyId: "agencyA" }, ["rory"])!;
    expect(filtered.splits).toHaveLength(1);
    expect(filtered.totalAmount).toBe(1700);
  });

  it("leaks no trace of the other family", () => {
    const filtered = filterExpenseFor(lunch, { audience: "payer", partyId: "agencyA" }, ["rory"])!;
    expect(JSON.stringify(filtered)).not.toContain("sam");
    expect(JSON.stringify(filtered)).not.toContain("familyB");
  });

  it("returns null when none of the splits belong to the audience", () => {
    expect(filterExpenseFor(lunch, { audience: "payer", partyId: "stranger" }, [])).toBeNull();
  });
});

describe("filterNotesFor", () => {
  const notes: Note[] = [
    { id: "n1", body: "private thought", attachedToType: "shift", attachedToId: "s1", visibility: { me: true, payer: false, guardian: false }, occurredAt: "x", recordedAt: "x", zone: "UTC", tags: [], customFields: {} },
    { id: "n2", body: "for the agency", attachedToType: "shift", attachedToId: "s1", visibility: { me: true, payer: true, guardian: false }, occurredAt: "x", recordedAt: "x", zone: "UTC", tags: [], customFields: {} },
    { id: "n3", body: "for gran", attachedToType: "shift", attachedToId: "s1", visibility: { me: true, payer: false, guardian: true }, occurredAt: "x", recordedAt: "x", zone: "UTC", tags: [], customFields: {} },
  ];

  it("gives me everything", () => {
    expect(filterNotesFor(notes, { audience: "me" })).toHaveLength(3);
  });

  it("gives a payer only payer-visible notes", () => {
    expect(filterNotesFor(notes, { audience: "payer", partyId: "agencyA" }).map((n) => n.id)).toEqual(["n2"]);
  });

  it("gives a guardian only guardian-visible notes", () => {
    expect(filterNotesFor(notes, { audience: "guardian", partyId: "gran" }).map((n) => n.id)).toEqual(["n3"]);
  });

  it("never includes a private note in a non-me audience", () => {
    for (const audience of ["payer", "guardian"] as const) {
      const out = filterNotesFor(notes, { audience, partyId: "x" });
      expect(out.some((n) => n.body === "private thought")).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../../src/domain/audience`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/audience.ts`:

```typescript
import type { Id } from "./primitives";
import type { ClientPartyRole, Expense, Note, Shift } from "./entities";
import { live, type EntityStore } from "./replay";

export type Audience = "me" | "payer" | "guardian";

export interface AudienceContext {
  audience: Audience;
  /** The party whose view this is. Ignored when audience is "me". */
  partyId?: Id;
}

/**
 * The clients an audience is allowed to know exist.
 *
 * Spec §7.1: this is a whitelist. Everything else in this module filters BY
 * selecting from this list, never by hiding fields from a full view — so a
 * record that should not be visible is absent rather than redacted.
 */
export function clientsVisibleTo(store: EntityStore, ctx: AudienceContext): Id[] {
  if (ctx.audience === "me") {
    const roles = live<ClientPartyRole>(store, "role");
    return [...new Set(roles.map((r) => r.clientId))].sort();
  }
  if (!ctx.partyId) return [];
  const wanted = ctx.audience === "payer" ? "payer" : "guardian";
  return live<ClientPartyRole>(store, "role")
    .filter((r) => r.partyId === ctx.partyId && r.role === wanted)
    .map((r) => r.clientId)
    .sort();
}

/** Rebuilds a shift containing only what the audience may see, or null. */
export function filterShiftFor(
  shift: Shift,
  ctx: AudienceContext,
  visibleClients: Id[],
): Shift | null {
  if (ctx.audience === "me") return shift;

  const participants = shift.participants.filter((p) => {
    if (!visibleClients.includes(p.clientId)) return false;
    if (ctx.audience === "payer") return p.payerPartyId === ctx.partyId;
    return true;
  });
  if (participants.length === 0) return null;

  return {
    ...shift,
    participants: participants.map((p) => {
      if (ctx.audience === "guardian") {
        // A guardian never sees what the worker earns. Spec §7.2.
        const { payRate: _payRate, payerPartyId: _payerPartyId, ...rest } = p;
        return rest as typeof p;
      }
      return p;
    }),
  };
}

/** Rebuilds an expense containing only the audience's own splits, or null. */
export function filterExpenseFor(
  expense: Expense,
  ctx: AudienceContext,
  visibleClients: Id[],
): Expense | null {
  if (ctx.audience === "me") return expense;

  const splits = expense.splits.filter((s) => {
    if (!visibleClients.includes(s.clientId)) return false;
    if (ctx.audience === "payer") return s.payerPartyId === ctx.partyId;
    return true;
  });
  if (splits.length === 0) return null;

  // The total is restated as this audience's share; the true total is another
  // payer's business.
  return { ...expense, splits, totalAmount: splits.reduce((t, s) => t + s.amount, 0) };
}

export function filterNotesFor(notes: Note[], ctx: AudienceContext): Note[] {
  if (ctx.audience === "me") return notes;
  return notes.filter((n) =>
    ctx.audience === "payer" ? n.visibility.payer : n.visibility.guardian,
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — the new tests, plus every earlier test still green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: filter records by audience so payer views cannot leak other families"
```

---

