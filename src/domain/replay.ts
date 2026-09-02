import { compareEvents, ENTITY_TYPES, type DomainEvent, type EntityType } from "./events";
import type { Id } from "./primitives";

export interface EntityRecord {
  id: Id;
  deleted?: boolean;
  [key: string]: unknown;
}

export type EntityStore = Record<EntityType, Map<Id, EntityRecord>>;



export function emptyStore(): EntityStore {
  const store = {} as EntityStore;
  for (const t of ENTITY_TYPES) store[t] = new Map();
  return store;
}

/**
 * Folds an event stream into current state. Pure and order-independent:
 * the events are sorted into a total order first, so any permutation of the
 * same stream produces identical output.
 *
 * INVARIANT: events must clear a field by setting it to `null`, never `undefined`.
 * `undefined` does not survive JSON serialization (events travel as JSONL between devices),
 * so an event intending to clear a field would silently fail to do so after round-tripping.
 */
export function replay(events: DomainEvent[]): EntityStore {
  const store = emptyStore();
  for (const e of [...events].sort(compareEvents)) {
    const bucket = store[e.entityType];
    if (!bucket) continue;
    const current = bucket.get(e.entityId) ?? { id: e.entityId };
    bucket.set(e.entityId, { ...current, ...e.fields, id: e.entityId });
  }
  return store;
}

/** Every non-deleted record of a type. */
export function live<T extends EntityRecord>(store: EntityStore, type: EntityType): T[] {
  return [...store[type].values()].filter((r) => !r.deleted) as T[];
}
