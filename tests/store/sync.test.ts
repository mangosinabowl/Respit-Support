import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { RespiteDb, appendEvent, hydrate, allEvents } from "../../src/store/db";
import { syncOnce, inMemoryRemote } from "../../src/store/sync";
import { makeEvent } from "../../src/domain/events";

let remote: ReturnType<typeof inMemoryRemote>;
beforeEach(() => { remote = inMemoryRemote(); });

/** A device with its own database and its own id. */
async function device(id: string) {
  const db = new RespiteDb(`sync-${id}-${Math.random()}`);
  await db.open();
  let seq = 0;
  return {
    id, db,
    async record(entity: "client" | "shift", entityId: string, fields: Record<string, unknown>) {
      seq += 1;
      await appendEvent(db, makeEvent(entity, entityId, fields, id, seq));
    },
    sync: () => syncOnce(db, remote, id),
    state: () => hydrate(db),
    count: async () => (await allEvents(db)).length,
  };
}

describe("syncOnce", () => {
  it("carries work between two devices in both directions", async () => {
    const phone = await device("phone");
    const laptop = await device("laptop");
    await phone.record("client", "c1", { name: "Rory" });
    await laptop.record("client", "c2", { name: "Placeholder" });

    await phone.sync();
    await laptop.sync();
    await phone.sync(); // phone picks up what laptop published

    expect(await phone.state()).toEqual(await laptop.state());
    expect(await phone.count()).toBe(2);
  });

  it("converges across three devices, whatever order they sync in", async () => {
    const a = await device("a"), b = await device("b"), c = await device("c");
    await a.record("client", "c1", { name: "Rory" });
    await b.record("client", "c2", { name: "Andrew" });
    await c.record("client", "c3", { name: "Placeholder" });

    // Deliberately uneven: syncing twice must not change the answer.
    await a.sync(); await b.sync(); await c.sync();
    await a.sync(); await b.sync(); await c.sync();

    const sa = await a.state(), sb = await b.state(), sc = await c.state();
    expect(sa).toEqual(sb);
    expect(sb).toEqual(sc);
    expect(await a.count()).toBe(3);
  });

  it("accepts a device that joins long after the others started", async () => {
    const a = await device("a"), b = await device("b");
    await a.record("client", "c1", { name: "Rory" });
    await b.record("client", "c2", { name: "Andrew" });
    await a.sync(); await b.sync(); await a.sync();

    // A brand new device needs no registration: it just syncs.
    const late = await device("late");
    await late.record("client", "c9", { name: "Late" });
    await late.sync();
    await a.sync();

    expect(await late.count()).toBe(3);
    expect(await a.count()).toBe(3);
    expect(await a.state()).toEqual(await late.state());
  });

  it("keeps the work of a device that stops syncing", async () => {
    const a = await device("a"), leaving = await device("gone");
    await leaving.record("shift", "s1", { minutes: 120 });
    await leaving.sync();
    await a.sync();

    // The device never syncs again. Its log stays, so the shift it recorded is
    // still there - a device going away must not erase the work it did.
    for (let i = 0; i < 3; i += 1) await a.sync();
    expect([...((await a.state()).shift ?? new Map()).keys()]).toEqual(["s1"]);
  });

  it("is idempotent: syncing repeatedly adds nothing and skips instead", async () => {
    const a = await device("a"), b = await device("b");
    await a.record("client", "c1", { name: "Rory" });
    await a.sync(); await b.sync();
    const first = await b.sync();
    const second = await b.sync();
    expect(second.pulled).toBe(0);
    expect(second.skipped).toBeGreaterThanOrEqual(first.pulled);
    expect(await b.count()).toBe(1);
  });

  it("publishes only its own events, never re-publishing another device's", async () => {
    const a = await device("a"), b = await device("b");
    await a.record("client", "c1", { name: "Rory" });
    await a.sync(); await b.sync();
    await b.sync();
    // b holds a's event but must not claim it as its own.
    expect(remote.logs["b"].every((e) => e.deviceId === "b")).toBe(true);
    expect(remote.logs["a"].map((e) => e.deviceId)).toEqual(["a"]);
  });

  it("two devices editing the same record settle the same way everywhere", async () => {
    const a = await device("a"), b = await device("b");
    await a.record("client", "c1", { name: "Rory", defaultRate: 2000 });
    await a.sync(); await b.sync();
    // Both change the rate without seeing each other.
    await a.record("client", "c1", { defaultRate: 2500 });
    await b.record("client", "c1", { defaultRate: 3000 });
    await a.sync(); await b.sync(); await a.sync(); await b.sync();

    const ra = (await a.state()).client!.get("c1") as any;
    const rb = (await b.state()).client!.get("c1") as any;
    // Whichever wins, both devices must agree - a rate that differs per device
    // is worse than either answer.
    expect(ra.defaultRate).toBe(rb.defaultRate);
    expect(ra.name).toBe("Rory");
  });

  it("one unreadable log does not cost the others", async () => {
    const a = await device("a"), b = await device("b");
    await b.record("client", "c2", { name: "Andrew" });
    await b.sync();
    remote.logs["broken"] = [];
    const original = remote.read.bind(remote);
    remote.read = async (id: string) => { if (id === "broken") throw new Error("unreadable"); return original(id); };

    const res = await a.sync();
    expect(res.pulled).toBe(1); // b's event still arrived
    expect([...((await a.state()).client ?? new Map()).keys()]).toEqual(["c2"]);
  });
});
