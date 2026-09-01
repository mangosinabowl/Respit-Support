# Respite Support — Core Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and prove correct the headless core of the Respite Support app — the event log, the entity model, and the allocation engine that decides who owes the worker what.

**Architecture:** Local-first and event-sourced. Every change is an immutable event appended to a per-device log; current state is a pure function of replaying those events in timestamp order. Nothing in this plan touches the network or the DOM, so every rule can be tested directly. The UI (plan 2) and Google Drive sync (plan 3) are later consumers of exactly these modules.

**Tech Stack:** TypeScript, Vite, Vitest, Dexie (IndexedDB), fake-indexeddb (tests).

**Spec:** `docs/superpowers/specs/2026-08-31-respite-support-design.md`

## Global Constraints

- **Money is integer minor units (cents), never floating point.** A `Money` value of `3450` means $34.50. Float arithmetic on money breaks the reconciliation invariant in spec §5.
- **Allocations must always sum exactly back to the total.** Spec §5: "The app can never produce claims summing to more than was spent or worked, and never silently drops a remainder."
- **Every record carries `occurredAt` and `recordedAt` as separate fields.** Spec §6.1.
- **Instants are stored as UTC ISO-8601 strings plus a separate IANA timezone string.** Never a local-time string, never a raw epoch number. Spec §6.2.
- **Records are never physically deleted.** Deletion sets `deleted: true`. Spec §4.
- **Rates are snapshotted onto records at creation and never recomputed.** Spec §6.3.
- **No network calls and no DOM access anywhere in `src/domain/`.** That directory must remain testable in a plain Node environment.
- Every task ends with a commit.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/domain/primitives.ts` | `Id`, `Money`, `ISOInstant`, `IanaZone`, id generation, clock |
| `src/domain/events.ts` | `DomainEvent` shape, event construction, ordering |
| `src/domain/replay.ts` | Folding an event stream into current entity state |
| `src/domain/entities.ts` | Entity interfaces: Party, Client, Role, Shift, Expense, Trip, Note, Tag, Preset |
| `src/domain/segments.ts` | Participant time segments and support ratios |
| `src/domain/allocation.ts` | The allocation engine: even money splits, time rules |
| `src/domain/invariants.ts` | Validation that splits reconcile; used before persistence |
| `src/domain/operations.ts` | Split, merge, move — expressed as events |
| `src/domain/queries.ts` | Derived reads: what is owed, by whom |
| `src/domain/audience.ts` | Audience filtering (spec §7) |
| `src/domain/backup.ts` | Full JSON export |
| `src/store/db.ts` | Dexie schema, event persistence, hydrate |
| `tests/domain/*.test.ts` | One test file per domain module |

Domain modules are pure. `src/store/db.ts` is the only file that touches IndexedDB.

---

### Task 1: Repository, toolchain, and a passing test

**Files:**
- Create: `.gitignore`, `package.json`, `tsconfig.json`, `vite.config.ts`, `src/domain/primitives.ts`
- Test: `tests/domain/primitives.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm test`; `newId(): Id`, `nowInstant(): ISOInstant`, `localZone(): IanaZone`.

**Critical:** this folder contains a client's safety plan PDF, an ABC chart, and a `Rory/` directory of client material. The `.gitignore` below must be written **before** the first `git add`, and the first commit must be inspected to confirm no client material is staged.

- [ ] **Step 1: Initialise the repository and write .gitignore first**

```bash
cd "C:/Users/aandr/OneDrive/Documentos/Respit Support"
git init
```

Create `.gitignore` with exactly this content:

```gitignore
# Client material — MUST NOT be committed
*.pdf
/Rory/
/*.png
/*.jpg
/*.jpeg

# Tooling
node_modules/
dist/
dev-dist/
coverage/
.env
.env.local
*.local
.DS_Store
```

- [ ] **Step 2: Verify no client material would be committed**

```bash
git add -A && git status --short
```

Expected: the listing contains `.gitignore` and `docs/superpowers/...` only. It must **not** contain `ABC Chart_260831_090920.pdf`, `RR Safety plan 13-Aug-2026 18-53-14.pdf`, or anything under `Rory/`. If any client file appears, stop, run `git reset`, fix `.gitignore`, and repeat this step.

- [ ] **Step 3: Scaffold the project**

```bash
npm create vite@latest . -- --template vanilla-ts
npm install
npm install --save-dev vitest fake-indexeddb
npm install dexie
```

If Vite refuses because the directory is not empty, accept its prompt to continue in the existing directory. Do not let it delete existing files.

- [ ] **Step 4: Configure the test runner**

Create `vite.config.ts`:

```typescript
import { defineConfig } from "vite";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Write the failing test**

Create `tests/domain/primitives.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { newId, nowInstant, localZone } from "../../src/domain/primitives";

describe("primitives", () => {
  it("generates unique ids", () => {
    const a = newId();
    const b = newId();
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThan(20);
  });

  it("produces a UTC ISO instant ending in Z", () => {
    const t = nowInstant();
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("produces an IANA zone name containing a slash or UTC", () => {
    const z = localZone();
    expect(z === "UTC" || z.includes("/")).toBe(true);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../../src/domain/primitives`.

- [ ] **Step 7: Write the implementation**

Create `src/domain/primitives.ts`:

```typescript
/** A stable unique identifier, generated on-device. */
export type Id = string;

/** Money in integer minor units (cents). 3450 === $34.50. Never a float. */
export type Money = number;

/** A UTC instant, ISO-8601 with milliseconds, always ending in Z. */
export type ISOInstant = string;

/** An IANA timezone name, e.g. "America/Los_Angeles". */
export type IanaZone = string;

export function newId(): Id {
  return crypto.randomUUID();
}

export function nowInstant(): ISOInstant {
  return new Date().toISOString();
}

export function localZone(): IanaZone {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Whole minutes between two instants. Negative if `to` precedes `from`. */
export function minutesBetween(from: ISOInstant, to: ISOInstant): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 60000);
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — the new tests, plus every earlier test still green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold project, protect client files, add time and id primitives"
```

---

### Task 2: The event log

**Files:**
- Create: `src/domain/events.ts`
- Test: `tests/domain/events.test.ts`

**Interfaces:**
- Consumes: `Id`, `ISOInstant`, `newId`, `nowInstant` from `src/domain/primitives`.
- Produces:
  - `type EntityType = "party" | "client" | "role" | "shift" | "expense" | "trip" | "note" | "tag" | "preset" | "submission" | "attachment" | "inboxItem"`
  - `interface DomainEvent { eventId: Id; entityType: EntityType; entityId: Id; fields: Record<string, unknown>; recordedAt: ISOInstant; deviceId: Id; seq: number }`
  - `makeEvent(entityType, entityId, fields, deviceId, seq): DomainEvent`
  - `compareEvents(a, b): number`

**Design note:** there is no separate create/update/delete event kind. An event carries only the fields it changes; a create is simply the first event for an id, and a delete is an event setting `deleted: true`. This is what makes per-field last-write-wins fall out of ordering alone, with no bookkeeping (spec §9.4).

- [ ] **Step 1: Write the failing test**

Create `tests/domain/events.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { makeEvent, compareEvents, type DomainEvent } from "../../src/domain/events";

describe("events", () => {
  it("stamps an event with a recordedAt and a unique id", () => {
    const e = makeEvent("client", "c1", { name: "Rory" }, "dev-a", 1);
    expect(e.entityType).toBe("client");
    expect(e.entityId).toBe("c1");
    expect(e.fields).toEqual({ name: "Rory" });
    expect(e.deviceId).toBe("dev-a");
    expect(e.seq).toBe(1);
    expect(e.recordedAt).toMatch(/Z$/);
    expect(e.eventId.length).toBeGreaterThan(20);
  });

  it("orders by recordedAt first", () => {
    const early = { recordedAt: "2026-01-01T00:00:00.000Z", deviceId: "b", seq: 9 } as DomainEvent;
    const late = { recordedAt: "2026-01-02T00:00:00.000Z", deviceId: "a", seq: 1 } as DomainEvent;
    expect(compareEvents(early, late)).toBeLessThan(0);
  });

  it("breaks ties deterministically by deviceId then seq", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const a1 = { recordedAt: at, deviceId: "dev-a", seq: 1 } as DomainEvent;
    const a2 = { recordedAt: at, deviceId: "dev-a", seq: 2 } as DomainEvent;
    const b1 = { recordedAt: at, deviceId: "dev-b", seq: 1 } as DomainEvent;
    expect(compareEvents(a1, a2)).toBeLessThan(0);
    expect(compareEvents(a1, b1)).toBeLessThan(0);
    expect(compareEvents(b1, a1)).toBeGreaterThan(0);
  });

  it("sorts a shuffled stream into a stable total order", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const evs = [
      { recordedAt: at, deviceId: "dev-b", seq: 1 },
      { recordedAt: at, deviceId: "dev-a", seq: 2 },
      { recordedAt: at, deviceId: "dev-a", seq: 1 },
    ] as DomainEvent[];
    const sorted = [...evs].sort(compareEvents).map((e) => `${e.deviceId}:${e.seq}`);
    expect(sorted).toEqual(["dev-a:1", "dev-a:2", "dev-b:1"]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../../src/domain/events`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/events.ts`:

```typescript
import { newId, nowInstant, type Id, type ISOInstant } from "./primitives";

export type EntityType =
  | "party"
  | "client"
  | "role"
  | "shift"
  | "expense"
  | "trip"
  | "note"
  | "tag"
  | "preset"
  | "submission"
  | "attachment"
  | "inboxItem";

/**
 * An immutable change. Carries only the fields it changes, so replaying a
 * stream in order yields per-field last-write-wins with no extra bookkeeping.
 */
export interface DomainEvent {
  eventId: Id;
  entityType: EntityType;
  entityId: Id;
  fields: Record<string, unknown>;
  recordedAt: ISOInstant;
  deviceId: Id;
  seq: number;
}

export function makeEvent(
  entityType: EntityType,
  entityId: Id,
  fields: Record<string, unknown>,
  deviceId: Id,
  seq: number,
): DomainEvent {
  return {
    eventId: newId(),
    entityType,
    entityId,
    fields,
    recordedAt: nowInstant(),
    deviceId,
    seq,
  };
}

/** Total order: time, then device, then per-device sequence. */
export function compareEvents(a: DomainEvent, b: DomainEvent): number {
  if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? -1 : 1;
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1;
  return a.seq - b.seq;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — the new tests, plus every earlier test still green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add domain event shape and deterministic total ordering"
```

---

### Task 3: Replay

**Files:**
- Create: `src/domain/replay.ts`
- Test: `tests/domain/replay.test.ts`

**Interfaces:**
- Consumes: `DomainEvent`, `compareEvents`, `EntityType`.
- Produces:
  - `interface EntityRecord { id: Id; deleted?: boolean; [key: string]: unknown }`
  - `type EntityStore = Record<EntityType, Map<Id, EntityRecord>>`
  - `replay(events: DomainEvent[]): EntityStore`
  - `live<T>(store, entityType): T[]` — non-deleted records only

This is the module the whole app depends on. Test it hardest.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/replay.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { replay, live } from "../../src/domain/replay";
import type { DomainEvent } from "../../src/domain/events";

function ev(
  entityId: string,
  fields: Record<string, unknown>,
  recordedAt: string,
  deviceId = "dev-a",
  seq = 1,
): DomainEvent {
  return {
    eventId: `${deviceId}-${recordedAt}-${seq}`,
    entityType: "client",
    entityId,
    fields,
    recordedAt,
    deviceId,
    seq,
  };
}

describe("replay", () => {
  it("builds a record from its first event", () => {
    const store = replay([ev("c1", { name: "Rory" }, "2026-01-01T00:00:00.000Z")]);
    expect(store.client.get("c1")).toEqual({ id: "c1", name: "Rory" });
  });

  it("merges later events field by field", () => {
    const store = replay([
      ev("c1", { name: "Rory", colour: "blue" }, "2026-01-01T00:00:00.000Z"),
      ev("c1", { colour: "green" }, "2026-01-02T00:00:00.000Z"),
    ]);
    expect(store.client.get("c1")).toEqual({ id: "c1", name: "Rory", colour: "green" });
  });

  it("is order-independent: a shuffled stream replays identically", () => {
    const a = ev("c1", { name: "Rory" }, "2026-01-01T00:00:00.000Z");
    const b = ev("c1", { colour: "green" }, "2026-01-02T00:00:00.000Z");
    const c = ev("c1", { name: "Rory R." }, "2026-01-03T00:00:00.000Z");
    expect(replay([c, a, b]).client.get("c1")).toEqual(replay([a, b, c]).client.get("c1"));
  });

  it("lets two devices edit different fields without either losing", () => {
    const store = replay([
      ev("c1", { name: "Rory" }, "2026-01-01T00:00:00.000Z", "dev-a", 1),
      ev("c1", { colour: "green" }, "2026-01-01T00:00:01.000Z", "dev-b", 1),
      ev("c1", { allergies: "peanuts" }, "2026-01-01T00:00:02.000Z", "dev-a", 2),
    ]);
    expect(store.client.get("c1")).toEqual({
      id: "c1",
      name: "Rory",
      colour: "green",
      allergies: "peanuts",
    });
  });

  it("resolves same-field conflicts by later timestamp", () => {
    const store = replay([
      ev("c1", { colour: "green" }, "2026-01-01T00:00:05.000Z", "dev-b", 1),
      ev("c1", { colour: "blue" }, "2026-01-01T00:00:01.000Z", "dev-a", 1),
    ]);
    expect(store.client.get("c1")!.colour).toBe("green");
  });

  it("soft-deletes without destroying the record", () => {
    const store = replay([
      ev("c1", { name: "Rory" }, "2026-01-01T00:00:00.000Z"),
      ev("c1", { deleted: true }, "2026-01-02T00:00:00.000Z"),
    ]);
    expect(store.client.get("c1")!.name).toBe("Rory");
    expect(live(store, "client")).toEqual([]);
  });

  it("restores a soft-deleted record when undeleted later", () => {
    const store = replay([
      ev("c1", { name: "Rory" }, "2026-01-01T00:00:00.000Z"),
      ev("c1", { deleted: true }, "2026-01-02T00:00:00.000Z"),
      ev("c1", { deleted: false }, "2026-01-03T00:00:00.000Z"),
    ]);
    expect(live(store, "client")).toHaveLength(1);
  });

  it("returns empty maps for an empty stream", () => {
    expect(live(replay([]), "client")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../../src/domain/replay`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/replay.ts`:

```typescript
import { compareEvents, type DomainEvent, type EntityType } from "./events";
import type { Id } from "./primitives";

export interface EntityRecord {
  id: Id;
  deleted?: boolean;
  [key: string]: unknown;
}

export type EntityStore = Record<EntityType, Map<Id, EntityRecord>>;

const ENTITY_TYPES: EntityType[] = [
  "party",
  "client",
  "role",
  "shift",
  "expense",
  "trip",
  "note",
  "tag",
  "preset",
  "submission",
  "attachment",
  "inboxItem",
];

export function emptyStore(): EntityStore {
  const store = {} as EntityStore;
  for (const t of ENTITY_TYPES) store[t] = new Map();
  return store;
}

/**
 * Folds an event stream into current state. Pure and order-independent:
 * the events are sorted into a total order first, so any permutation of the
 * same stream produces identical output.
 */
export function replay(events: DomainEvent[]): EntityStore {
  const store = emptyStore();
  for (const e of [...events].sort(compareEvents)) {
    const bucket = store[e.entityType];
    if (!bucket) continue;
    const current = bucket.get(e.entityId) ?? { id: e.entityId };
    bucket.set(e.entityId, { ...current, ...e.fields, id: e.entityId });
  }
  return store;
}

/** Every non-deleted record of a type. */
export function live<T extends EntityRecord>(store: EntityStore, type: EntityType): T[] {
  return [...store[type].values()].filter((r) => !r.deleted) as T[];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — the new tests, plus every earlier test still green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: replay event streams into entity state with per-field last-write-wins"
```

---

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

### Task 8: Invariants

**Files:**
- Create: `src/domain/invariants.ts`
- Test: `tests/domain/invariants.test.ts`

**Interfaces:**
- Consumes: `Expense`, `Trip`, `Shift`, `MoneySplit`.
- Produces:
  - `interface Violation { code: string; message: string; field?: string }`
  - `checkExpense(expense: Expense): Violation[]`
  - `checkTrip(trip: Trip): Violation[]`
  - `checkShift(shift: Shift): Violation[]`
  - `isSubmittable(violations: Violation[]): boolean`

Spec §4.5 and §14: unallocated money is shown in red and blocks submission.

- [ ] **Step 1: Write the failing test**

Create `tests/domain/invariants.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { checkExpense, checkTrip, checkShift, isSubmittable } from "../../src/domain/invariants";
import type { Expense, Trip, Shift } from "../../src/domain/entities";

const base = {
  occurredAt: "2026-03-01T22:00:00.000Z",
  recordedAt: "2026-03-01T22:00:00.000Z",
  zone: "UTC",
  tags: [],
  customFields: {},
};

function expense(over: Partial<Expense> = {}): Expense {
  return {
    ...base,
    id: "e1",
    totalAmount: 3400,
    category: "food",
    description: "Lunch",
    receiptAttachmentIds: ["a1"],
    splits: [
      { clientId: "c1", payerPartyId: "p1", amount: 1700 },
      { clientId: "c2", payerPartyId: "p2", amount: 1700 },
    ],
    reimbursementStatus: "unclaimed",
    ...over,
  } as Expense;
}

describe("checkExpense", () => {
  it("passes when splits sum to the total", () => {
    expect(checkExpense(expense())).toEqual([]);
  });

  it("flags under-allocation with the exact shortfall", () => {
    const v = checkExpense(expense({ splits: [{ clientId: "c1", payerPartyId: "p1", amount: 1700 }] }));
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe("SPLITS_DO_NOT_SUM");
    expect(v[0].message).toContain("17.00");
  });

  it("flags over-allocation", () => {
    const v = checkExpense(
      expense({
        splits: [
          { clientId: "c1", payerPartyId: "p1", amount: 2000 },
          { clientId: "c2", payerPartyId: "p2", amount: 2000 },
        ],
      }),
    );
    expect(v[0].code).toBe("SPLITS_DO_NOT_SUM");
  });

  it("flags an expense with no splits at all", () => {
    expect(checkExpense(expense({ splits: [] }))[0].code).toBe("NO_SPLITS");
  });

  it("flags a missing receipt", () => {
    const v = checkExpense(expense({ receiptAttachmentIds: [] }));
    expect(v.map((x) => x.code)).toContain("NO_RECEIPT");
  });

  it("flags a negative or zero total", () => {
    expect(checkExpense(expense({ totalAmount: 0, splits: [] })).map((v) => v.code)).toContain(
      "NON_POSITIVE_TOTAL",
    );
  });
});

describe("checkTrip", () => {
  const trip = (over: Partial<Trip> = {}): Trip =>
    ({
      ...base,
      id: "t1",
      distance: 12,
      distanceUnit: "mi",
      purpose: "Park",
      isClaimable: true,
      splits: [{ clientId: "c1", payerPartyId: "p1", distanceShare: 12, rateApplied: 67, claimAmount: 804 }],
      reimbursementStatus: "unclaimed",
      ...over,
    }) as Trip;

  it("passes a well-formed trip", () => {
    expect(checkTrip(trip())).toEqual([]);
  });

  it("flags a claim amount that does not match distance times rate", () => {
    const v = checkTrip(
      trip({ splits: [{ clientId: "c1", payerPartyId: "p1", distanceShare: 12, rateApplied: 67, claimAmount: 999 }] }),
    );
    expect(v[0].code).toBe("CLAIM_MISMATCH");
  });

  it("allows fuel cost to be recorded alongside a mileage claim without adding it", () => {
    const withFuel = trip({ fuelCostAmount: 4500 });
    expect(checkTrip(withFuel)).toEqual([]);
    // The claim is unchanged by the presence of fuel cost — no double claim. Spec §4.6.
    expect(withFuel.splits.reduce((t, s) => t + s.claimAmount, 0)).toBe(804);
  });

  it("skips claim checks on a non-claimable trip", () => {
    expect(checkTrip(trip({ isClaimable: false, splits: [] }))).toEqual([]);
  });
});

describe("checkShift", () => {
  const shift = (over: Partial<Shift> = {}): Shift =>
    ({
      ...base,
      id: "s1",
      startAt: "2026-03-01T22:00:00.000Z",
      endAt: "2026-03-02T01:00:00.000Z",
      participants: [
        {
          clientId: "c1",
          payerPartyId: "p1",
          inAt: "2026-03-01T22:00:00.000Z",
          outAt: "2026-03-02T01:00:00.000Z",
          payRate: 3000,
          timeRule: "fullPerPayer",
        },
      ],
      isIncident: false,
      reimbursementStatus: "unclaimed",
      ...over,
    }) as Shift;

  it("passes a well-formed shift", () => {
    expect(checkShift(shift())).toEqual([]);
  });

  it("flags a shift with no participants", () => {
    expect(checkShift(shift({ participants: [] }))[0].code).toBe("NO_PARTICIPANTS");
  });

  it("flags an end before the start", () => {
    expect(checkShift(shift({ endAt: "2026-03-01T20:00:00.000Z" }))[0].code).toBe("END_BEFORE_START");
  });

  it("flags a participant outside the shift window", () => {
    const s = shift();
    s.participants[0].outAt = "2026-03-02T09:00:00.000Z";
    expect(checkShift(s).map((v) => v.code)).toContain("PARTICIPANT_OUTSIDE_SHIFT");
  });

  it("flags a still-running shift as not submittable but not invalid", () => {
    const v = checkShift(shift({ endAt: undefined }));
    expect(v.map((x) => x.code)).toContain("STILL_RUNNING");
  });
});

describe("isSubmittable", () => {
  it("is true when there are no violations", () => {
    expect(isSubmittable([])).toBe(true);
  });

  it("is false when there is any violation", () => {
    expect(isSubmittable([{ code: "NO_SPLITS", message: "x" }])).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../../src/domain/invariants`.

- [ ] **Step 3: Write the implementation**

Create `src/domain/invariants.ts`:

```typescript
import type { Expense, Shift, Trip } from "./entities";
import type { Money } from "./primitives";

export interface Violation {
  code: string;
  message: string;
  field?: string;
}

function dollars(cents: Money): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function checkExpense(expense: Expense): Violation[] {
  const violations: Violation[] = [];

  if (expense.totalAmount <= 0) {
    violations.push({
      code: "NON_POSITIVE_TOTAL",
      message: "An expense must be more than zero.",
      field: "totalAmount",
    });
  }

  if (expense.splits.length === 0) {
    violations.push({
      code: "NO_SPLITS",
      message: "Nobody is assigned to pay this back.",
      field: "splits",
    });
  } else {
    const sum = expense.splits.reduce((t, s) => t + s.amount, 0);
    if (sum !== expense.totalAmount) {
      const diff = expense.totalAmount - sum;
      violations.push({
        code: "SPLITS_DO_NOT_SUM",
        message:
          diff > 0
            ? `$${dollars(diff)} of this expense is not assigned to anyone.`
            : `$${dollars(-diff)} more than the receipt is assigned out.`,
        field: "splits",
      });
    }
  }

  if (expense.receiptAttachmentIds.length === 0) {
    violations.push({
      code: "NO_RECEIPT",
      message: "No receipt photo attached.",
      field: "receiptAttachmentIds",
    });
  }

  return violations;
}

export function checkTrip(trip: Trip): Violation[] {
  const violations: Violation[] = [];
  if (!trip.isClaimable) return violations;

  if (trip.splits.length === 0) {
    violations.push({
      code: "NO_SPLITS",
      message: "Nobody is assigned to reimburse this trip.",
      field: "splits",
    });
  }

  for (const s of trip.splits) {
    const expected = Math.round(s.distanceShare * s.rateApplied);
    if (s.claimAmount !== expected) {
      violations.push({
        code: "CLAIM_MISMATCH",
        message: `Claim of $${dollars(s.claimAmount)} does not match ${s.distanceShare} × the rate ($${dollars(expected)}).`,
        field: "splits",
      });
    }
  }

  return violations;
}

export function checkShift(shift: Shift): Violation[] {
  const violations: Violation[] = [];

  if (shift.participants.length === 0) {
    violations.push({
      code: "NO_PARTICIPANTS",
      message: "This shift has nobody on it.",
      field: "participants",
    });
  }

  if (!shift.endAt) {
    violations.push({
      code: "STILL_RUNNING",
      message: "This shift has not been stopped yet.",
      field: "endAt",
    });
    return violations;
  }

  if (Date.parse(shift.endAt) < Date.parse(shift.startAt)) {
    violations.push({
      code: "END_BEFORE_START",
      message: "The shift ends before it starts.",
      field: "endAt",
    });
  }

  for (const p of shift.participants) {
    if (
      Date.parse(p.inAt) < Date.parse(shift.startAt) ||
      Date.parse(p.outAt) > Date.parse(shift.endAt)
    ) {
      violations.push({
        code: "PARTICIPANT_OUTSIDE_SHIFT",
        message: "Someone's times fall outside the shift.",
        field: "participants",
      });
    }
  }

  return violations;
}

export function isSubmittable(violations: Violation[]): boolean {
  return violations.length === 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — the new tests, plus every earlier test still green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: enforce reconciliation invariants on expenses, trips and shifts"
```

---

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

### Task 10: Persistence

**Files:**
- Create: `src/store/db.ts`
- Test: `tests/store/db.test.ts`

**Interfaces:**
- Consumes: `DomainEvent`, `replay`, `EntityStore`.
- Produces:
  - `class RespiteDb` with `events` table
  - `appendEvent(db, event): Promise<void>`
  - `allEvents(db): Promise<DomainEvent[]>`
  - `hydrate(db): Promise<EntityStore>`
  - `nextSeq(db, deviceId): Promise<number>`
  - `deviceId(): Id` — persisted in localStorage, generated once per device

- [ ] **Step 1: Write the failing test**

Create `tests/store/db.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { RespiteDb, appendEvent, allEvents, hydrate, nextSeq } from "../../src/store/db";
import { makeEvent } from "../../src/domain/events";
import { live } from "../../src/domain/replay";

let db: RespiteDb;

beforeEach(async () => {
  db = new RespiteDb(`test-${Math.random()}`);
  await db.open();
});

describe("db", () => {
  it("stores and returns an appended event", async () => {
    const e = makeEvent("client", "c1", { name: "Rory" }, "dev-a", 1);
    await appendEvent(db, e);
    expect(await allEvents(db)).toEqual([e]);
  });

  it("hydrates entity state from stored events", async () => {
    await appendEvent(db, makeEvent("client", "c1", { name: "Rory" }, "dev-a", 1));
    await appendEvent(db, makeEvent("client", "c2", { name: "Sam" }, "dev-a", 2));
    const store = await hydrate(db);
    expect(live(store, "client").map((c) => c.name).sort()).toEqual(["Rory", "Sam"]);
  });

  it("hydrates an empty database to an empty store", async () => {
    expect(live(await hydrate(db), "client")).toEqual([]);
  });

  it("issues sequence numbers per device starting at 1", async () => {
    expect(await nextSeq(db, "dev-a")).toBe(1);
    await appendEvent(db, makeEvent("client", "c1", { name: "Rory" }, "dev-a", 1));
    expect(await nextSeq(db, "dev-a")).toBe(2);
    expect(await nextSeq(db, "dev-b")).toBe(1);
  });

  it("is idempotent: appending the same event twice stores it once", async () => {
    const e = makeEvent("client", "c1", { name: "Rory" }, "dev-a", 1);
    await appendEvent(db, e);
    await appendEvent(db, e);
    expect(await allEvents(db)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../../src/store/db`.

- [ ] **Step 3: Write the implementation**

Create `src/store/db.ts`:

```typescript
import Dexie, { type Table } from "dexie";
import type { DomainEvent } from "../domain/events";
import { replay, type EntityStore } from "../domain/replay";
import { newId, type Id } from "../domain/primitives";

export class RespiteDb extends Dexie {
  events!: Table<DomainEvent, string>;

  constructor(name = "respite-support") {
    super(name);
    // `deviceId` is indexed on its own as well as compounded: Dexie cannot
    // serve a plain `where("deviceId")` equality query from `[deviceId+seq]`.
    this.version(1).stores({
      events: "eventId, entityType, entityId, recordedAt, deviceId, [deviceId+seq]",
    });
  }
}

/** Appends an event. Idempotent by eventId, so replayed syncs cannot duplicate. */
export async function appendEvent(db: RespiteDb, event: DomainEvent): Promise<void> {
  await db.events.put(event);
}

export async function allEvents(db: RespiteDb): Promise<DomainEvent[]> {
  return db.events.toArray();
}

export async function hydrate(db: RespiteDb): Promise<EntityStore> {
  return replay(await allEvents(db));
}

/** The next per-device sequence number. Starts at 1. */
export async function nextSeq(db: RespiteDb, deviceId: Id): Promise<number> {
  const forDevice = await db.events.where("deviceId").equals(deviceId).toArray();
  return forDevice.reduce((max, e) => Math.max(max, e.seq), 0) + 1;
}

const DEVICE_KEY = "respite.deviceId";

/** A stable id for this device, generated once and kept in localStorage. */
export function deviceId(): Id {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const fresh = newId();
  localStorage.setItem(DEVICE_KEY, fresh);
  return fresh;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — the new tests, plus every earlier test still green.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: persist the event log in IndexedDB and hydrate state from it"
```

---

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
