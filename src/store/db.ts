import Dexie, { type Table } from "dexie";
import type { DomainEvent } from "../domain/events";
import { compareEvents } from "../domain/events";
import { replay, type EntityStore } from "../domain/replay";
import { newId, type Id } from "../domain/primitives";

interface SeqRecord {
  deviceId: string;
  nextSeq: number;
}

export class EventConflictError extends Error {
  constructor(
    message: string,
    readonly stored: DomainEvent,
    readonly incoming: DomainEvent
  ) {
    super(message);
    this.name = "EventConflictError";
  }
}

export class RespiteDb extends Dexie {
  events!: Table<DomainEvent, string>;
  seqs!: Table<SeqRecord, string>;

  constructor(name = "respite-support") {
    super(name);
    this.version(1).stores({
      events: "eventId, entityType, entityId, recordedAt, &[deviceId+seq]",
      seqs: "deviceId",
    });
    this.version(2)
      .stores({
        events: "eventId, entityType, entityId, recordedAt, &[deviceId+seq]",
        seqs: "deviceId",
      })
      .upgrade(async (tx) => {
        // Resolve any duplicate (deviceId, seq) pairs from v1 by renumbering them
        const allEvents = await tx.table<DomainEvent>("events").toArray();
        const seen = new Map<string, number>();
        const toUpdate: DomainEvent[] = [];

        for (const event of allEvents) {
          const key = `${event.deviceId}:${event.seq}`;
          if (seen.has(key)) {
            // Duplicate found; renumber it to a fresh seq for this device
            const nextSeqForDevice = Math.max(
              ...(allEvents
                .filter((e) => e.deviceId === event.deviceId)
                .map((e) => e.seq) || [0])
            ) + 1;
            toUpdate.push({ ...event, seq: nextSeqForDevice });
          } else {
            seen.set(key, event.seq);
          }
        }

        for (const event of toUpdate) {
          await tx.table<DomainEvent>("events").put(event);
        }
      });
  }
}

/** Appends an event. Idempotent by eventId: identical re-delivery is silently ignored. Distinct events colliding on (deviceId, seq) throw EventConflictError. */
export async function appendEvent(db: RespiteDb, event: DomainEvent): Promise<void> {
  try {
    await db.events.add(event);
  } catch (err) {
    if (!(err instanceof Dexie.ConstraintError)) {
      throw err;
    }
    // Constraint error: could be duplicate eventId (idempotent) or collision on (deviceId, seq).
    // Read what's stored and compare.
    const stored = await db.events.get(event.eventId);
    if (stored && deepEqual(stored, event)) {
      // Identical event already stored: genuine idempotency, return silently.
      return;
    }
    // Different event (same eventId but different content, or collision on (deviceId, seq)): this is an error.
    throw new EventConflictError(
      `Event conflict: attempted to store an event that collides with an existing one. EventId: ${event.eventId}`,
      stored!,
      event
    );
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
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`count must be a positive integer, got ${count}`);
  }

  return db.transaction("rw", [db.seqs, db.events], async () => {
    let record = await db.seqs.get(deviceId);

    // If no counter row exists, seed from the max seq in the event log for this device.
    if (!record) {
      const eventsForDevice = await db.events.where("deviceId").equals(deviceId).toArray();
      const maxSeq = eventsForDevice.reduce((max, e) => Math.max(max, e.seq), 0);
      record = { deviceId, nextSeq: maxSeq };
    }

    const startSeq = record.nextSeq + 1;
    await db.seqs.put({ deviceId, nextSeq: startSeq + count - 1 });
    return startSeq;
  });
}

const DEVICE_KEY = "respite.deviceId";
let sessionDeviceId: Id | null = null;

/** A stable id for this device, generated once and kept in localStorage. Falls back to a session-scoped id if localStorage is unavailable or does not persist writes. */
export function deviceId(): Id {
  try {
    const existing = localStorage.getItem(DEVICE_KEY);
    if (existing !== null && existing !== "") return existing;

    const fresh = newId();
    localStorage.setItem(DEVICE_KEY, fresh);

    // Verify the write persisted: read back and confirm.
    const written = localStorage.getItem(DEVICE_KEY);
    if (written === fresh) return fresh;

    // Storage accepted the write but did not persist it: fall through to session id.
  } catch {
    // localStorage unavailable or throws: fall through to session id.
  }

  // localStorage unavailable, throwing, or not persisting: use session-scoped id.
  if (sessionDeviceId === null) {
    sessionDeviceId = newId();
  }
  return sessionDeviceId;
}

/** Deep equality check for two values (recursively). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object" || a === null || b === null) return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj).sort();
  const bKeys = Object.keys(bObj).sort();

  if (aKeys.length !== bKeys.length) return false;
  if (!aKeys.every((k, i) => k === bKeys[i])) return false;

  return aKeys.every((k) => deepEqual(aObj[k], bObj[k]));
}
