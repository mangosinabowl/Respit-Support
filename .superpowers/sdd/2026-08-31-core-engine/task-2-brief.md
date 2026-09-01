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

