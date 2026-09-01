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

