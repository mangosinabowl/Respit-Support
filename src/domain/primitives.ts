/** A stable unique identifier, generated on-device. */
export type Id = string;

/** Money in integer minor units (cents). 3450 === $34.50. Never a float. */
export type Money = number;

/** A UTC instant, ISO-8601 with milliseconds, always ending in Z. */
export type ISOInstant = string;

/** An IANA timezone name, e.g. "America/Los_Angeles". */
export type IanaZone = string;

export function newId(): Id {
  return crypto.randomUUID();
}

export function nowInstant(): ISOInstant {
  return new Date().toISOString();
}

export function localZone(): IanaZone {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Whole minutes between two instants. Negative if `to` precedes `from`. */
export function minutesBetween(from: ISOInstant, to: ISOInstant): number {
  // Rounds UP: a part minute is a minute the worker was there, and rounding it
  // away would quietly shave time off every shift that does not end on the
  // minute. Never negative - an outAt before inAt is zero, not a credit.
  const ms = Date.parse(to) - Date.parse(from);
  return ms <= 0 ? 0 : Math.ceil(ms / 60000);
}
