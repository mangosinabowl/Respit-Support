import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { RespiteDb, appendEvent, allEvents, hydrate, nextSeq, deviceId, EventConflictError } from "../../src/store/db";
import { makeEvent } from "../../src/domain/events";
import { live } from "../../src/domain/replay";

let db: RespiteDb;

/** A working localStorage backed by a Map. */
function mapStorage(store: Map<string, string>) {
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
  };
}

/** Runs fn with globalThis.localStorage swapped (undefined = absent), then restores. */
function withLocalStorage<T>(stub: unknown, fn: () => T): T {
  const had = "localStorage" in globalThis;
  const prev = (globalThis as Record<string, unknown>).localStorage;
  if (stub === undefined) {
    delete (globalThis as Record<string, unknown>).localStorage;
  } else {
    Object.defineProperty(globalThis, "localStorage", { value: stub, configurable: true, writable: true });
  }
  try {
    return fn();
  } finally {
    if (had) {
      Object.defineProperty(globalThis, "localStorage", { value: prev, configurable: true, writable: true });
    } else {
      delete (globalThis as Record<string, unknown>).localStorage;
    }
  }
}

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

  it("is idempotent: appending identical event twice stores it once", async () => {
    const e = makeEvent("client", "c1", { name: "Rory" }, "dev-a", 1);
    await appendEvent(db, e);
    await appendEvent(db, e);
    expect(await allEvents(db)).toHaveLength(1);
  });

  it("throws on collision with different content (same eventId, different fields)", async () => {
    const e1 = makeEvent("client", "c1", { name: "Rory" }, "dev-a", 1);
    const e2 = { ...e1, fields: { name: "Roy" } }; // Same eventId, different content
    await appendEvent(db, e1);
    await expect(appendEvent(db, e2)).rejects.toThrow(EventConflictError);
  });

  it("throws on collision when distinct events collide on (deviceId, seq)", async () => {
    const e1 = makeEvent("client", "c1", { name: "First" }, "dev-a", 1);
    const e2 = { ...makeEvent("client", "c2", { name: "Second" }, "dev-a", 1), eventId: "diff-id" };
    await appendEvent(db, e1);
    await expect(appendEvent(db, e2)).rejects.toThrow(EventConflictError);
  });

  it("handles concurrent nextSeq calls atomically", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => nextSeq(db, "dev-a"))
    );
    expect(new Set(results).size).toBe(50); // All 50 unique
    expect(results.sort((a, b) => a - b)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
  });

  it("reserves blocks of contiguous sequence numbers atomically", async () => {
    const block3 = await nextSeq(db, "dev-b", 3);
    const single1 = await nextSeq(db, "dev-b", 1);
    expect(block3).toBe(1);
    expect(single1).toBe(4);
  });

  it("seeds nextSeq from maximum event seq when no counter row exists", async () => {
    // Append events directly with seq 1, 2, 3
    await appendEvent(db, makeEvent("client", "c1", { name: "A" }, "dev-a", 1));
    await appendEvent(db, makeEvent("client", "c2", { name: "B" }, "dev-a", 2));
    await appendEvent(db, makeEvent("client", "c3", { name: "C" }, "dev-a", 3));

    // Delete the counter row to simulate restore-from-backup
    await db.seqs.delete("dev-a");

    // nextSeq should seed from max event seq (3) and return 4
    expect(await nextSeq(db, "dev-a")).toBe(4);
  });

  it("validates count parameter", async () => {
    await expect(nextSeq(db, "dev-a", 0)).rejects.toThrow("count must be a positive integer");
    await expect(nextSeq(db, "dev-a", -1)).rejects.toThrow("count must be a positive integer");
    await expect(nextSeq(db, "dev-a", 2.5)).rejects.toThrow("count must be a positive integer");
  });

  it("allEvents returns events sorted by compareEvents", async () => {
    // Append in non-sorted order
    const now = new Date().toISOString();
    const e5 = { ...makeEvent("client", "c5", { name: "E" }, "dev-a", 5), recordedAt: now };
    const e1 = { ...makeEvent("client", "c1", { name: "A" }, "dev-a", 1), recordedAt: now };
    const e3 = { ...makeEvent("client", "c3", { name: "C" }, "dev-a", 3), recordedAt: now };
    await appendEvent(db, e5);
    await appendEvent(db, e1);
    await appendEvent(db, e3);
    const events = await allEvents(db);
    expect(events.map((e) => e.seq)).toEqual([1, 3, 5]);
  });

  it("persists events durably across database closes and reopens", async () => {
    const e = makeEvent("client", "c1", { name: "Persistent" }, "dev-a", 1);
    await appendEvent(db, e);
    await db.close();

    // Reopen by name
    const db2 = new RespiteDb(db.name);
    await db2.open();
    const events = await allEvents(db2);
    expect(events).toHaveLength(1);
    expect(events[0].eventId).toBe(e.eventId);
    await db2.close();
  });

  it("deviceId returns the same value when called multiple times (happy path)", async () => {
    const id1 = deviceId();
    const id2 = deviceId();
    expect(id1).toBe(id2);
    expect(typeof id1).toBe("string");
    expect(id1.length).toBeGreaterThan(0);
  });

  it("EventConflictError.stored is populated for (deviceId, seq) collision", async () => {
    const e1 = makeEvent("client", "c1", { name: "First" }, "dev-a", 1);
    const e2 = { ...makeEvent("client", "c2", { name: "Second" }, "dev-a", 1), eventId: "diff-id" };
    await appendEvent(db, e1);
    try {
      await appendEvent(db, e2);
      expect.fail("Should have thrown EventConflictError");
    } catch (err) {
      expect(err instanceof EventConflictError).toBe(true);
      if (err instanceof EventConflictError) {
        // stored must be populated for (deviceId, seq) collision
        expect(err.stored).toBeDefined();
        expect(err.stored?.eventId).toBe(e1.eventId);
      }
    }
  });

  it("migration: old v1 database with duplicate (deviceId, seq) opens and deduplicates", async () => {
    // Create a v1-shaped database with duplicates
    const oldDb = new Dexie(`migrate-v1-${Math.random()}`) as any;
    // The genuinely shipped v1 (commit fce5c0d) had NO seqs table.
    oldDb.version(1).stores({
      events: "eventId, entityType, entityId, recordedAt, deviceId, [deviceId+seq]",
    });
    await oldDb.open();

    // Insert events with duplicate (deviceId, seq) pairs (like the broken build would)
    const e1 = makeEvent("client", "c1", { name: "First" }, "dev-a", 1);
    const e2 = { ...makeEvent("client", "c2", { name: "Dup1" }, "dev-a", 1), eventId: "e2" };
    const e3 = { ...makeEvent("client", "c3", { name: "Dup2" }, "dev-a", 1), eventId: "e3" };
    const e4 = makeEvent("shift", "s1", { startedAt: "2026-01-01T00:00:00Z" }, "dev-a", 2);
    const e5 = makeEvent("shift", "s2", { startedAt: "2026-01-01T01:00:00Z" }, "dev-b", 1);

    await oldDb.events.add(e1);
    await oldDb.events.add(e2);
    await oldDb.events.add(e3);
    await oldDb.events.add(e4);
    await oldDb.events.add(e5);

    const countBefore = 5;
    await oldDb.close();

    // Open with RespiteDb (v1 -> v2 -> v3 migration)
    const newDb = new RespiteDb(oldDb.name);
    await newDb.open();

    // Verify: database opened successfully
    const events = await allEvents(newDb);
    expect(events.length).toBe(countBefore);

    // Verify: all original eventIds are present
    const eventIds = events.map((e) => e.eventId).sort();
    expect(eventIds).toContain(e1.eventId);
    expect(eventIds).toContain(e2.eventId);
    expect(eventIds).toContain(e3.eventId);
    expect(eventIds).toContain(e4.eventId);
    expect(eventIds).toContain(e5.eventId);

    // Verify: (deviceId, seq) pairs are now unique
    const pairs = new Set<string>();
    let pairConflicts = 0;
    for (const event of events) {
      const key = `${event.deviceId}:${event.seq}`;
      if (pairs.has(key)) {
        pairConflicts++;
      }
      pairs.add(key);
    }
    expect(pairConflicts).toBe(0);

    await newDb.close();
  });

  it("migration: clean v1 database (no duplicates) migrates without changes", async () => {
    const oldDb = new Dexie(`migrate-clean-${Math.random()}`) as any;
    // The genuinely shipped v1 (commit fce5c0d) had NO seqs table.
    oldDb.version(1).stores({
      events: "eventId, entityType, entityId, recordedAt, deviceId, [deviceId+seq]",
    });
    await oldDb.open();

    // Insert events with NO duplicates
    const e1 = makeEvent("client", "c1", { name: "Alice" }, "dev-a", 1);
    const e2 = makeEvent("client", "c2", { name: "Bob" }, "dev-a", 2);
    await oldDb.events.add(e1);
    await oldDb.events.add(e2);
    await oldDb.close();

    // Open with RespiteDb
    const newDb = new RespiteDb(oldDb.name);
    await newDb.open();
    const events = await allEvents(newDb);

    expect(events).toHaveLength(2);
    expect(events.map((e) => e.eventId).sort()).toEqual([e1.eventId, e2.eventId].sort());

    await newDb.close();
  });

  it("open fresh database succeeds without migration side effects", async () => {
    const e1 = makeEvent("client", "c1", { name: "Fresh" }, "dev-a", 1);
    await appendEvent(db, e1);
    const events = await allEvents(db);
    expect(events).toHaveLength(1);
    expect(events[0].eventId).toBe(e1.eventId);
  });

  it("counter seeds above renumbered maximum after migration", async () => {
    // Create v1 with duplicates
    const oldDb = new Dexie(`migrate-counter-${Math.random()}`) as any;
    // The genuinely shipped v1 (commit fce5c0d) had NO seqs table.
    oldDb.version(1).stores({
      events: "eventId, entityType, entityId, recordedAt, deviceId, [deviceId+seq]",
    });
    await oldDb.open();

    const e1 = makeEvent("client", "c1", { name: "A" }, "dev-a", 1);
    const e2 = { ...makeEvent("client", "c2", { name: "B" }, "dev-a", 1), eventId: "e2" };
    await oldDb.events.add(e1);
    await oldDb.events.add(e2);
    await oldDb.close();

    // Open with RespiteDb
    const newDb = new RespiteDb(oldDb.name);
    await newDb.open();

    // nextSeq should seed from the maximum renumbered seq
    // Pairs resolve to dev-a:1,2 so the only correct answer is 3.
    // toBeGreaterThan(1) also accepts 2 - exactly what seeding from the
    // PRE-renumber maximum returns, i.e. the bug this test is named for.
    const next = await nextSeq(newDb, "dev-a");
    expect(next).toBe(3);

    await newDb.close();
  });

  it("propagates non-ConstraintError failures unchanged", async () => {
    // Inject a failure at the write itself while the table stays readable, so the
    // error cannot be re-thrown incidentally by the follow-up lookup. A closed
    // database would not distinguish: its lookup throws the same error anyway.
    class DiskFullError extends Error {}
    const e = makeEvent("client", "c1", { name: "Test" }, "dev-a", 1);
    const realAdd = db.events.add.bind(db.events);
    db.events.add = (() => Promise.reject(new DiskFullError("disk full"))) as unknown as typeof db.events.add;

    let caught: unknown;
    try {
      await appendEvent(db, e);
    } catch (err) {
      caught = err;
    } finally {
      db.events.add = realAdd;
    }
    // Must reach the caller untouched: neither swallowed nor rewritten as a conflict.
    expect(caught).toBeInstanceOf(DiskFullError);
    expect(caught).not.toBeInstanceOf(EventConflictError);
  });

  it("deviceId regenerates when the stored value is an empty string", () => {
    const store = new Map<string, string>([["respite.deviceId", ""]]);
    const id = withLocalStorage(mapStorage(store), () => deviceId());
    expect(id).not.toBe("");
    expect(store.get("respite.deviceId")).toBe(id);
  });

  it("deviceId persists to localStorage and returns it again (happy path)", () => {
    const store = new Map<string, string>();
    const stub = mapStorage(store);
    const first = withLocalStorage(stub, () => deviceId());
    const second = withLocalStorage(stub, () => deviceId());
    expect(first).toBe(second);
    expect(store.get("respite.deviceId")).toBe(first);
  });

  it("deviceId is stable when localStorage is absent", () => {
    const a = withLocalStorage(undefined, () => deviceId());
    const b = withLocalStorage(undefined, () => deviceId());
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it("deviceId is stable when localStorage getItem throws", () => {
    const throwing = {
      getItem() { throw new Error("SecurityError: access denied"); },
      setItem() { throw new Error("SecurityError: access denied"); },
    };
    const a = withLocalStorage(throwing, () => deviceId());
    const b = withLocalStorage(throwing, () => deviceId());
    expect(a).toBe(b);
  });

  it("deviceId is stable when setItem throws (private-browsing quota)", () => {
    const quota = {
      getItem: () => null,
      setItem() { throw new Error("QuotaExceededError"); },
    };
    const a = withLocalStorage(quota, () => deviceId());
    const b = withLocalStorage(quota, () => deviceId());
    expect(a).toBe(b);
  });

  it("deviceId is stable when storage accepts writes but does not persist them", () => {
    // The nastiest mode: nothing throws, so only the read-back check catches it.
    // Without that check this returns a NEW uuid every call, which makes every
    // event look like it came from a different device and breaks all ordering.
    const silent = { getItem: () => null, setItem: () => {} };
    const ids = [
      withLocalStorage(silent, () => deviceId()),
      withLocalStorage(silent, () => deviceId()),
      withLocalStorage(silent, () => deviceId()),
    ];
    expect(new Set(ids).size).toBe(1);
  });

  it("migration renumbers in recordedAt order, not storage order", async () => {
    // eventIds are deliberately in the OPPOSITE lexicographic order to recordedAt.
    // Dexie returns rows in primary-key (eventId) order, so a migration that does
    // not sort would let "aaa" keep seq 1; sorting by recordedAt gives it to "zzz".
    const seed = () => [
      { ...makeEvent("client", "c1", { n: 1 }, "dev-a", 1), eventId: "zzz", recordedAt: "2026-01-01T00:00:00.000Z" },
      { ...makeEvent("client", "c2", { n: 2 }, "dev-a", 1), eventId: "aaa", recordedAt: "2026-01-01T00:00:01.000Z" },
      { ...makeEvent("client", "c3", { n: 3 }, "dev-a", 1), eventId: "mmm", recordedAt: "2026-01-01T00:00:02.000Z" },
    ];
    const migrateOnce = async () => {
      const old = new Dexie(`determinism-${Math.random()}`) as any;
      old.version(1).stores({
        events: "eventId, entityType, entityId, recordedAt, deviceId, [deviceId+seq]",
      });
      await old.open();
      for (const e of seed()) await old.events.add(e);
      await old.close();
      const migrated = new RespiteDb(old.name);
      await migrated.open();
      const map = Object.fromEntries((await allEvents(migrated)).map((e) => [e.eventId, e.seq]));
      await migrated.close();
      return map;
    };

    // The earliest-recorded event keeps the original number; later ones move up.
    expect(await migrateOnce()).toEqual({ zzz: 1, aaa: 2, mmm: 3 });
    // And two devices migrating copies of the same log must agree, or their
    // sequence numbers diverge and the merged log is inconsistent.
    expect(await migrateOnce()).toEqual(await migrateOnce());
  });

  it("a renumbered event stays idempotent for a clean re-delivery", async () => {
    const old = new Dexie(`roundtrip-${Math.random()}`) as any;
    old.version(1).stores({
      events: "eventId, entityType, entityId, recordedAt, deviceId, [deviceId+seq]",
    });
    await old.open();
    await old.events.add(makeEvent("client", "c1", { name: "Keep" }, "dev-a", 1));
    await old.events.add({ ...makeEvent("client", "c2", { name: "Moved" }, "dev-a", 1), eventId: "moved" });
    await old.close();

    const migrated = new RespiteDb(old.name);
    await migrated.open();
    const renumbered = (await allEvents(migrated)).find((e) => e.eventId === "moved")!;

    // A JSON round-trip is exactly what an export/import or a sync peer produces.
    // A stray marker key left on the stored row would make this throw forever.
    const cleanCopy = JSON.parse(JSON.stringify(renumbered));
    const before = (await allEvents(migrated)).length;
    await appendEvent(migrated, cleanCopy);
    expect((await allEvents(migrated)).length).toBe(before);
    await migrated.close();
  });
});
