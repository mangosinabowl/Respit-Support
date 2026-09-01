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

