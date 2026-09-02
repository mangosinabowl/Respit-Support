import type { Shift, Client } from "../domain/entities";
import { minutesBetween } from "../domain/primitives";

/**
 * Writing shifts into Google Calendar.
 *
 * Scope is calendar.app.created: the app may create and manage calendars it
 * made itself, and nothing else. It cannot read or alter the user's existing
 * calendars, so putting shifts in their pocket costs them no other access.
 *
 * Everything lands in one calendar named below, which the user can hide, colour
 * or delete without touching their own. Events are keyed on the shift id, so
 * sending twice updates rather than duplicates.
 */
export const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.app.created";
const CALENDARS = "https://www.googleapis.com/calendar/v3/calendars";
const LIST = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const CALENDAR_NAME = "Respite Support";

export interface CalendarPushResult {
  created: number;
  updated: number;
  calendarId: string;
}

async function call(token: string, url: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`Calendar said ${res.status}: ${(await res.text()).slice(0, 180)}`);
  return res.status === 204 ? null : res.json();
}

/** Finds the app's own calendar, creating it the first time. */
async function ownCalendar(token: string): Promise<string> {
  const list = await call(token, `${LIST}?maxResults=250`);
  const found = (list.items ?? []).find((c: any) => c.summary === CALENDAR_NAME);
  if (found) return found.id;
  const made = await call(token, CALENDARS, {
    method: "POST",
    body: JSON.stringify({ summary: CALENDAR_NAME, description: "Shifts recorded in Respite Support.", timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  });
  return made.id;
}

/** Google ids must be lowercase base32hex; a uuid is not, so it is encoded. */
const eventIdFor = (shiftId: string) =>
  `respite${shiftId.replace(/-/g, "").toLowerCase().replace(/[^0-9a-v]/g, "0")}`.slice(0, 60);

export async function pushShifts(
  token: string,
  shifts: Shift[],
  clients: Client[],
): Promise<CalendarPushResult> {
  const calendarId = await ownCalendar(token);
  const name = (id: string) => clients.find((c) => c.id === id)?.name ?? "someone";
  let created = 0;
  let updated = 0;

  for (const s of shifts) {
    if (!s.endAt) continue; // a running shift has no end to put in a calendar yet
    const who = s.participants.map((p) => name(p.clientId)).join(", ") || "Shift";
    const mins = s.participants.reduce((m, p) => Math.max(m, minutesBetween(p.inAt, p.outAt)), 0);
    const body = {
      id: eventIdFor(s.id),
      summary: `${who}${s.isIncident ? " (incident)" : ""}`,
      description: [
        `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m of support.`,
        ...s.participants.map((p) => `${name(p.clientId)} ${p.inAt.slice(11, 16)}\u2013${p.outAt.slice(11, 16)} at ${(p.payRate / 100).toFixed(2)}/h`),
        "Recorded in Respite Support.",
      ].join("\n"),
      start: { dateTime: s.startAt },
      end: { dateTime: s.endAt },
    };
    try {
      await call(token, `${CALENDARS}/${encodeURIComponent(calendarId)}/events`, { method: "POST", body: JSON.stringify(body) });
      created += 1;
    } catch (err: any) {
      // Already there: update it, so re-sending corrects rather than duplicates.
      if (!/409/.test(err.message)) throw err;
      await call(token, `${CALENDARS}/${encodeURIComponent(calendarId)}/events/${body.id}`, { method: "PUT", body: JSON.stringify(body) });
      updated += 1;
    }
  }
  return { created, updated, calendarId };
}
