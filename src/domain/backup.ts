import { nowInstant } from "./primitives";
import type { EntityStore } from "./replay";

/**
 * Everything, as JSON, including soft-deleted records. This is the user's
 * escape hatch: they are never locked in and never dependent on this app
 * continuing to exist (spec §13).
 */
export function exportAll(store: EntityStore): string {
  const payload: Record<string, unknown> = {
    version: 1,
    exportedAt: nowInstant(),
  };
  for (const [entityType, records] of Object.entries(store)) {
    payload[entityType] = [...(records as Map<string, unknown>).values()];
  }
  return JSON.stringify(payload, null, 2);
}
