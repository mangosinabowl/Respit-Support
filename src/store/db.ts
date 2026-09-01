import Dexie, { type Table } from "dexie";
import type { DomainEvent } from "../domain/events";
import { compareEvents } from "../domain/events";
import { replay, type EntityStore } from "../domain/replay";
import { newId, type Id } from "../domain/primitives";

interface SeqRecord {
  deviceId: string;
  nextSeq: number;
}

export class RespiteDb extends Dexie {
  events!: Table<DomainEvent, string>;
  seqs!: Table<SeqRecord, "deviceId">;

  constructor(name = "respite-support") {
    super(name);
    this.version(1).stores({
      events: "eventId, entityType, entityId, recordedAt, deviceId, &[deviceId+seq]",
      seqs: "deviceId",
    });
  }
}

/** Appends an event. Idempotent by eventId: duplicate appends are silently rejected. */
export async function appendEvent(db: RespiteDb, event: DomainEvent): Promise<void> {
  try {
    await db.events.add(event);
  } catch (err) {
    // ConstraintError on duplicate eventId is expected and idempotent.
    if (!(err instanceof Dexie.ConstraintError)) {
      throw err;
    }
  }
}

export async function allEvents(db: RespiteDb): Promise<DomainEvent[]> {
  const events = await db.events.toArray();
  events.sort(compareEvents);
  return events;
}

export async function hydrate(db: RespiteDb): Promise<EntityStore> {
  return replay(await allEvents(db));
}

/** The next per-device sequence number(s). Reserves `count` contiguous numbers atomically and returns the first. */
export async function nextSeq(db: RespiteDb, deviceId: Id, count: number = 1): Promise<number> {
  return (db.transaction as any)("rw", db.seqs, async () => {
    const record = await db.seqs.get(deviceId as any);
    const startSeq = (record?.nextSeq ?? 0) + 1;
    await db.seqs.put({ deviceId: deviceId as any, nextSeq: startSeq + count - 1 });
    return startSeq;
  });
}

const DEVICE_KEY = "respite.deviceId";
let sessionDeviceId: Id | null = null;

/** A stable id for this device, generated once and kept in localStorage. Falls back to a session-scoped id if localStorage is unavailable. */
export function deviceId(): Id {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing !== null && existing !== "") return existing;
    const fresh = newId();
    localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    // localStorage unavailable (private browsing, disabled, etc.): fall back to session id
    if (sessionDeviceId === null) {
      sessionDeviceId = newId();
    }
    return sessionDeviceId;
  }
}
