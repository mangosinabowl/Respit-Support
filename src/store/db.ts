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
