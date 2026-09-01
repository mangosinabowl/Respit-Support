import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { RespiteDb, appendEvent, allEvents, hydrate, nextSeq, deviceId, EventConflictError } from "../../src/store/db";
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

  it("deviceId returns the same value when called multiple times", async () => {
    const id1 = deviceId();
    const id2 = deviceId();
    expect(id1).toBe(id2);
  });

  it("seeding nextSeq from event log handles restore-from-backup scenario", async () => {
    // Simulate restore from backup: events exist but counter row doesn't
    const e1 = makeEvent("client", "c1", { name: "A" }, "dev-x", 1);
    const e2 = makeEvent("client", "c2", { name: "B" }, "dev-x", 2);
    const e3 = makeEvent("client", "c3", { name: "C" }, "dev-x", 5);

    // Append events
    await appendEvent(db, e1);
    await appendEvent(db, e2);
    await appendEvent(db, e3);

    // Verify max seq in events is 5
    const stored = await allEvents(db);
    expect(Math.max(...stored.map((e) => e.seq))).toBe(5);

    // Delete the counter row (simulating a corrupted counter or restore)
    await db.seqs.delete("dev-x");

    // nextSeq should seed from max event seq and return 6
    const next = await nextSeq(db, "dev-x");
    expect(next).toBe(6);
  });
});
