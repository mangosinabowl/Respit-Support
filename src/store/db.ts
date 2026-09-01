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
    readonly stored: DomainEvent | undefined,
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
    // v1: the schema as actually shipped (commit fce5c0d) - events only, non-unique.
    // Never retro-edit a shipped version's declaration: rebuilding an index as
    // unique over rows that already violate it aborts the whole upgrade transaction.
    this.version(1).stores({
      events: "eventId, entityType, entityId, recordedAt, deviceId, [deviceId+seq]",
    });
    // v2: add the seqs table and renumber duplicate (deviceId, seq) pairs left by v1.
    // Still non-unique here, so the upgrade can actually run.
    this.version(2)
      .stores({
        events: "eventId, entityType, entityId, recordedAt, deviceId, [deviceId+seq]",
        seqs: "deviceId",
      })
      .upgrade(async (tx) => {
        const all = await tx.table<DomainEvent>("events").toArray();
        // Deterministic order: two devices migrating copies of the same log must
        // resolve the same events onto the same sequence numbers. toArray() yields
        // random primary-key (UUID) order, which would not.
        all.sort((a, b) =>
          a.recordedAt < b.recordedAt ? -1 :
          a.recordedAt > b.recordedAt ? 1 :
          a.eventId < b.eventId ? -1 :
          a.eventId > b.eventId ? 1 : 0
        );

        const perDeviceMax = new Map<string, number>();
        const seen = new Set<string>();
        const toRenumber: DomainEvent[] = [];

        // First pass: record the true per-device maximum and spot duplicates.
        for (const event of all) {
          const key = `${event.deviceId}:${event.seq}`;
          perDeviceMax.set(event.deviceId, Math.max(perDeviceMax.get(event.deviceId) ?? 0, event.seq));
          if (seen.has(key)) toRenumber.push(event);
          seen.add(key);
        }

        // Second pass: renumber above the running maximum, which is unoccupied by
        // construction. The first event to claim a pair keeps it; later ones move.
        for (const event of toRenumber) {
          const newSeq = (perDeviceMax.get(event.deviceId) ?? 0) + 1;
          perDeviceMax.set(event.deviceId, newSeq);
          await tx.table<DomainEvent>("events").put({ ...event, seq: newSeq });
        }
      });
    // v3: Make (deviceId, seq) unique
    this.version(3)
      .stores({
        events: "eventId, entityType, entityId, recordedAt, deviceId, &[deviceId+seq]",
        seqs: "deviceId",
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
    // Try both lookups.
    let stored = await db.events.get(event.eventId);
    if (!stored) {
      // Not found by eventId; might be collision on (deviceId, seq).
      // Look up by the compound index.
      const withSameSeq = await db.events
        .where("deviceId")
        .equals(event.deviceId)
        .filter((e) => e.seq === event.seq)
        .first();
      stored = withSameSeq;
    }

    if (stored && deepEqual(stored, event)) {
      // Identical event already stored: genuine idempotency, return silently.
      return;
    }
    // Different event or collision: this is an error.
    throw new EventConflictError(
      `Event conflict: attempted to store an event that collides with an existing one. EventId: ${event.eventId}, DeviceId: ${event.deviceId}, Seq: ${event.seq}`,
      stored,
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

/** The whole event log as JSON. Unlike the entity snapshot, this can be restored. */
export async function exportEventLog(db: RespiteDb): Promise<string> {
  return JSON.stringify({ version: 1, kind: "respite-event-log", exportedAt: new Date().toISOString(), events: await allEvents(db) }, null, 2);
}

export interface RestoreResult { imported: number; skipped: number; conflicts: DomainEvent[] }

/**
 * Restores an exported log. Identical re-delivery is skipped, genuine conflicts
 * are collected rather than aborting the import, so one bad event cannot cost
 * the user the rest of the restore.
 */
export async function importEventLog(db: RespiteDb, json: string): Promise<RestoreResult> {
  const parsed = JSON.parse(json);
  const events: DomainEvent[] = parsed?.events;
  if (!Array.isArray(events)) throw new Error("Not a respite event log: no events array.");

  const result: RestoreResult = { imported: 0, skipped: 0, conflicts: [] };
  for (const event of events) {
    const before = await db.events.get(event.eventId);
    try {
      await appendEvent(db, event);
      if (before) result.skipped += 1;
      else result.imported += 1;
    } catch (err) {
      if (err instanceof EventConflictError) result.conflicts.push(event);
      else throw err;
    }
  }
  return result;
}
