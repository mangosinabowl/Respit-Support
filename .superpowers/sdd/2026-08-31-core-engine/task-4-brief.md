### Task 4: Entity interfaces

**Files:**
- Create: `src/domain/entities.ts`
- Test: `tests/domain/entities.test.ts`

**Interfaces:**
- Consumes: `Id`, `Money`, `ISOInstant`, `IanaZone`, `EntityRecord`.
- Produces: the interfaces below, plus `NOTE_PRIVATE: NoteVisibility`.

These are the exact shapes from spec §4. Later tasks refer to these names.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/entities.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { NOTE_PRIVATE, type Shift, type Expense } from "../../src/domain/entities";

describe("entities", () => {
  it("defaults a note to private", () => {
    expect(NOTE_PRIVATE).toEqual({ me: true, payer: false, guardian: false });
  });

  it("types a shift with participants carrying their own times", () => {
    const shift: Shift = {
      id: "s1",
      occurredAt: "2026-03-01T22:00:00.000Z",
      recordedAt: "2026-03-01T22:00:00.000Z",
      zone: "America/Los_Angeles",
      startAt: "2026-03-01T22:00:00.000Z",
      endAt: "2026-03-02T01:00:00.000Z",
      participants: [
        {
          clientId: "c1",
          payerPartyId: "p1",
          inAt: "2026-03-01T22:00:00.000Z",
          outAt: "2026-03-02T01:00:00.000Z",
          payRate: 2500,
          timeRule: "fullPerPayer",
        },
      ],
      isIncident: false,
      reimbursementStatus: "unclaimed",
      tags: [],
      customFields: {},
    };
    expect(shift.participants[0].payRate).toBe(2500);
  });

  it("types an expense with splits in integer cents", () => {
    const expense: Expense = {
      id: "e1",
      occurredAt: "2026-03-01T23:00:00.000Z",
      recordedAt: "2026-03-01T23:05:00.000Z",
      zone: "America/Los_Angeles",
      totalAmount: 3400,
      category: "food",
      description: "Lunch",
      receiptAttachmentIds: [],
      splits: [
        { clientId: "c1", payerPartyId: "p1", amount: 1134 },
        { clientId: "c2", payerPartyId: "p2", amount: 2266 },
      ],
      reimbursementStatus: "unclaimed",
      tags: [],
      customFields: {},
    };
    const sum = expense.splits.reduce((t, s) => t + s.amount, 0);
    expect(sum).toBe(expense.totalAmount);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../../src/domain/entities`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/entities.ts`:

```typescript
import type { Id, Money, ISOInstant, IanaZone } from "./primitives";

/** Fields every record carries. Spec §4. */
export interface BaseRecord {
  id: Id;
  occurredAt: ISOInstant;
  recordedAt: ISOInstant;
  zone: IanaZone;
  deleted?: boolean;
  tags: Id[];
  customFields: Record<string, string>;
}

export type ReimbursementStatus = "unclaimed" | "submitted" | "paid" | "notReimbursable";
export type TimeRule = "fullPerPayer" | "splitEvenly";
export type MileagePolicy = "share" | "fullPerPayer";
export type PartyRole = "payer" | "guardian" | "emergencyContact";
export type ExpenseCategory = "food" | "activity" | "supplies" | "other";

export interface Party extends BaseRecord {
  kind: "person" | "org";
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  /** Reimbursed per unit distance, in cents. */
  defaultMileageRate: Money;
  mileagePolicy: MileagePolicy;
  timePolicy: TimeRule;
  /** 0 = exact; 15 = round shift durations to quarter hours. */
  roundingMinutes: number;
}

export interface Client extends BaseRecord {
  name: string;
  displayInitial: string;
  colour: string;
  dateOfBirth?: string;
  address?: string;
  allergies?: string;
  accessNotes?: string;
  attachmentIds: Id[];
  archived: boolean;
}

/** Joins a Party to a Client in a role. One Party may hold several. Spec §4.2. */
export interface ClientPartyRole extends BaseRecord {
  clientId: Id;
  partyId: Id;
  role: PartyRole;
}

export interface Participant {
  clientId: Id;
  payerPartyId: Id;
  inAt: ISOInstant;
  outAt: ISOInstant;
  /** Snapshot of the hourly rate in cents. Never recomputed. Spec §6.3. */
  payRate: Money;
  timeRule: TimeRule;
}

export interface Shift extends BaseRecord {
  startAt: ISOInstant;
  /** Null while a timer is running. */
  endAt?: ISOInstant;
  participants: Participant[];
  isIncident: boolean;
  reimbursementStatus: ReimbursementStatus;
  submissionId?: Id;
}

export interface MoneySplit {
  clientId: Id;
  payerPartyId: Id;
  amount: Money;
}

export interface Expense extends BaseRecord {
  totalAmount: Money;
  category: ExpenseCategory;
  description: string;
  shiftId?: Id;
  receiptAttachmentIds: Id[];
  splits: MoneySplit[];
  reimbursementStatus: ReimbursementStatus;
  submissionId?: Id;
}

export interface TripSplit {
  clientId: Id;
  payerPartyId: Id;
  distanceShare: number;
  /** Snapshot of the rate per unit distance, in cents. */
  rateApplied: Money;
  claimAmount: Money;
}

export interface Trip extends BaseRecord {
  distance: number;
  distanceUnit: "mi" | "km";
  purpose: string;
  isClaimable: boolean;
  odometerStart?: number;
  odometerEnd?: number;
  /** Actual dollars at the pump. Recorded only; NEVER added to a claim. Spec §4.6. */
  fuelCostAmount?: Money;
  shiftId?: Id;
  splits: TripSplit[];
  reimbursementStatus: ReimbursementStatus;
  submissionId?: Id;
}

export interface NoteVisibility {
  me: true;
  payer: boolean;
  guardian: boolean;
}

export const NOTE_PRIVATE: NoteVisibility = { me: true, payer: false, guardian: false };

export interface Note extends BaseRecord {
  body: string;
  attachedToType: string;
  attachedToId: Id;
  visibility: NoteVisibility;
}

export interface Tag extends BaseRecord {
  label: string;
  colour: string;
}

export interface Preset extends BaseRecord {
  kind: "split" | "expense" | "shift";
  label: string;
  payload: Record<string, unknown>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — the new tests, plus every earlier test still green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: define domain entity interfaces from spec section 4"
```

---

