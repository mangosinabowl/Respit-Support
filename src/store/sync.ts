import type { DomainEvent } from "../domain/events";
import { compareEvents } from "../domain/events";
import { RespiteDb, allEvents, appendEvent, EventConflictError } from "./db";

/**
 * Where synced logs live. Deliberately tiny so Drive, a folder, or a test double
 * can all satisfy it.
 *
 * Each device owns exactly ONE file and only ever writes its own. Nobody
 * rewrites a shared file, so any number of devices can sync at once without
 * overwriting each other - which is what makes three, five or ten devices no
 * harder than two.
 */
export interface RemoteStore {
  /** Device ids that currently have a log. May grow or shrink between calls. */
  listDevices(): Promise<string[]>;
  /** One device's events. Missing or unreadable logs come back empty. */
  read(deviceId: string): Promise<DomainEvent[]>;
  /** Replaces this device's own log. Never called for another device's log. */
  write(deviceId: string, events: DomainEvent[]): Promise<void>;
}

export interface SyncResult {
  /** Events this device published. */
  pushed: number;
  /** Events taken in from other devices. */
  pulled: number;
  /** Already held, so ignored - re-syncing is not a duplicate. */
  skipped: number;
  /** Other devices seen in this round. */
  devicesSeen: string[];
  /**
   * Events that could not be taken in because they clash with something already
   * stored. Kept aside rather than dropped, and never aborts the rest.
   */
  conflicts: DomainEvent[];
}

/**
 * One sync round: publish what this device knows, take in what everyone else
 * knows.
 *
 * A device that has never synced before needs no registration - it simply
 * appears when it first writes a log. A device that stops syncing leaves its
 * log behind, so the work it recorded is never lost. Neither case needs any
 * other device to be told.
 */
export async function syncOnce(db: RespiteDb, remote: RemoteStore, myDeviceId: string): Promise<SyncResult> {
  const local = await allEvents(db);

  // Publish only our own events. Re-publishing another device's events would
  // make us a second source of truth for work we did not record.
  const mine = local.filter((e) => e.deviceId === myDeviceId);
  await remote.write(myDeviceId, mine);

  const devices = (await remote.listDevices()).filter((d) => d !== myDeviceId);
  const held = new Set(local.map((e) => e.eventId));
  const result: SyncResult = { pushed: mine.length, pulled: 0, skipped: 0, devicesSeen: devices, conflicts: [] };

  for (const device of devices) {
    let theirs: DomainEvent[];
    try {
      theirs = await remote.read(device);
    } catch {
      // One unreadable log must not cost us every other device's work.
      continue;
    }
    for (const event of theirs.sort(compareEvents)) {
      if (held.has(event.eventId)) {
        result.skipped += 1;
        continue;
      }
      try {
        await appendEvent(db, event);
        held.add(event.eventId);
        result.pulled += 1;
      } catch (err) {
        if (err instanceof EventConflictError) result.conflicts.push(event);
        else throw err;
      }
    }
  }
  return result;
}

/** A remote backed by a plain object. Used by the tests, and by nothing else. */
export function inMemoryRemote(): RemoteStore & { logs: Record<string, DomainEvent[]> } {
  const logs: Record<string, DomainEvent[]> = {};
  return {
    logs,
    async listDevices() { return Object.keys(logs); },
    async read(deviceId) { return logs[deviceId] ? [...logs[deviceId]] : []; },
    async write(deviceId, events) { logs[deviceId] = [...events]; },
  };
}
