import { newId, nowInstant, type Id, type ISOInstant } from "./primitives";

/**
 * The runtime list is the source of truth and EntityType is derived from it.
 * They were separate lists once, and adding a type to one but not the other
 * left that entity with no map at all - every read of it crashed the app.
 */
export const ENTITY_TYPES = [
  "party",
  "client",
  "role",
  "shift",
  "expense",
  "trip",
  "note",
  "tag",
  "preset",
  "submission",
  "attachment",
  "inboxItem",
  "adjustment",
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

/**
 * An immutable change. Carries only the fields it changes, so replaying a
 * stream in order yields per-field last-write-wins with no extra bookkeeping.
 */
export interface DomainEvent {
  eventId: Id;
  entityType: EntityType;
  entityId: Id;
  fields: Record<string, unknown>;
  recordedAt: ISOInstant;
  deviceId: Id;
  seq: number;
}

export function makeEvent(
  entityType: EntityType,
  entityId: Id,
  fields: Record<string, unknown>,
  deviceId: Id,
  seq: number,
): DomainEvent {
  return {
    eventId: newId(),
    entityType,
    entityId,
    fields,
    recordedAt: nowInstant(),
    deviceId,
    seq,
  };
}

/** Total order: time, then device, then per-device sequence. */
export function compareEvents(a: DomainEvent, b: DomainEvent): number {
  if (a.recordedAt !== b.recordedAt) return a.recordedAt < b.recordedAt ? -1 : 1;
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1;
  return a.seq - b.seq;
}
