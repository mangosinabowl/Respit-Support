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
