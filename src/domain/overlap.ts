import type { Shift } from "./entities";
import type { Id } from "./primitives";

export interface Overlap {
  other: Shift;
  /** The people who appear on both, which is what makes it a billing problem. */
  clientIds: Id[];
  from: string;
  to: string;
  minutes: number;
}

const overlapWindow = (aFrom: string, aTo: string, bFrom: string, bTo: string) => {
  const from = aFrom > bFrom ? aFrom : bFrom;
  const to = aTo < bTo ? aTo : bTo;
  return from < to ? { from, to } : null;
};

/**
 * Shifts that cover the same time as this one AND share a person with it.
 *
 * Two shifts overlapping is not by itself wrong: the worker can hand over to
 * someone else, or a second family's shift can run alongside. It becomes a
 * problem when the same person is on both, because their time is then billed
 * twice for the same hour - allocateTime reconciles people within one shift and
 * has no view across shifts, so nothing else would catch it.
 *
 * A shift never conflicts with itself, and a running shift with no end is
 * treated as running up to `now` rather than forever.
 */
export function findOverlaps(candidate: Shift, others: Shift[], now = new Date().toISOString()): Overlap[] {
  const aFrom = candidate.startAt;
  const aTo = candidate.endAt ?? now;
  const mine = new Set(candidate.participants.map((p) => p.clientId));
  const out: Overlap[] = [];

  for (const other of others) {
    if (other.id === candidate.id || other.deleted) continue;
    const shared = [...new Set(other.participants.map((p) => p.clientId))].filter((id) => mine.has(id));
    if (!shared.length) continue;

    const window = overlapWindow(aFrom, aTo, other.startAt, other.endAt ?? now);
    if (!window) continue;

    out.push({
      other,
      clientIds: shared,
      from: window.from,
      to: window.to,
      minutes: Math.round((Date.parse(window.to) - Date.parse(window.from)) / 60000),
    });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from));
}
