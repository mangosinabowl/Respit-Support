import { minutesBetween, type Id, type ISOInstant } from "./primitives";
import type { Participant } from "./entities";

/** A stretch of time during which the set of people present does not change. */
export interface Segment {
  from: ISOInstant;
  to: ISOInstant;
  clientIds: Id[];
  minutes: number;
}

/**
 * Splits a shift into constant-attendance segments. Boundaries are every
 * in-time and out-time; a segment with nobody present is dropped, so gaps
 * between non-overlapping participants do not appear.
 */
export function segmentsFor(participants: Participant[]): Segment[] {
  const present = participants.filter((p) => Date.parse(p.outAt) > Date.parse(p.inAt));
  if (present.length === 0) return [];

  const boundaries = [
    ...new Set(present.flatMap((p) => [p.inAt, p.outAt])),
  ].sort((a, b) => Date.parse(a) - Date.parse(b));

  const segments: Segment[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const from = boundaries[i];
    const to = boundaries[i + 1];
    const clientIds = present
      .filter((p) => Date.parse(p.inAt) <= Date.parse(from) && Date.parse(p.outAt) >= Date.parse(to))
      .map((p) => p.clientId)
      .sort();
    if (clientIds.length === 0) continue;
    segments.push({ from, to, clientIds, minutes: minutesBetween(from, to) });
  }
  return segments;
}
