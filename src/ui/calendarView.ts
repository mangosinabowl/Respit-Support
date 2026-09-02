import type { Shift, Expense, Trip, Note, Client } from "../domain/entities";
import { allocateTime } from "../domain/timeAllocation";
import { minutesBetween } from "../domain/primitives";
import { dayKey, daysIn, monthsIn, spanFor, type Grain, type Span } from "../domain/calendar";

export interface DayTally {
  minutes: number;
  money: number;
  shifts: Shift[];
  expenses: Expense[];
  trips: Trip[];
  notes: Note[];
  incident: boolean;
}

const empty = (): DayTally => ({ minutes: 0, money: 0, shifts: [], expenses: [], trips: [], notes: [], incident: false });

/**
 * Everything that happened, filed under the local day it happened on.
 *
 * A shift counts its longest single presence rather than the sum of everyone's,
 * because the calendar is showing how long the worker was out, not how much is
 * billed. The money is what is billed, which is a different number whenever two
 * payers overlap - showing one and labelling it the other is how a day comes to
 * look wrong.
 */
export function tallyByDay(shifts: Shift[], expenses: Expense[], trips: Trip[], notes: Note[], zone?: string): Map<string, DayTally> {
  const out = new Map<string, DayTally>();
  const at = (key: string) => {
    if (!out.has(key)) out.set(key, empty());
    return out.get(key)!;
  };

  for (const s of shifts) {
    const t = at(dayKey(s.startAt, zone));
    t.shifts.push(s);
    if (s.isIncident) t.incident = true;
    if (s.endAt) {
      t.minutes += s.participants.reduce((m, p) => Math.max(m, minutesBetween(p.inAt, p.outAt)), 0);
      t.money += allocateTime(s.participants).reduce((a, c) => a + c.amount, 0);
    }
  }
  for (const e of expenses) {
    const t = at(dayKey(e.occurredAt, zone));
    t.expenses.push(e);
    t.money += e.totalAmount;
  }
  for (const p of trips) {
    const t = at(dayKey(p.occurredAt, zone));
    t.trips.push(p);
    t.money += p.splits.reduce((a, sp) => a + sp.claimAmount, 0);
  }
  for (const n of notes) at(dayKey(n.occurredAt, zone)).notes.push(n);
  return out;
}

export function sumRange(tally: Map<string, DayTally>, from: string, to: string): DayTally {
  const total = empty();
  for (const [key, day] of tally) {
    if (key < from || key > to) continue;
    total.minutes += day.minutes;
    total.money += day.money;
    total.shifts.push(...day.shifts);
    total.expenses.push(...day.expenses);
    total.trips.push(...day.trips);
    total.notes.push(...day.notes);
    total.incident ||= day.incident;
  }
  return total;
}

/** How much detail each zoom shows. Kept here so the view and the labels agree. */
export function detailFor(grain: Grain): "everything" | "twoWeeks" | "summary" | "months" | "indicators" {
  if (grain === "day" || grain === "week") return "everything";
  if (grain === "fortnight") return "twoWeeks";
  if (grain === "month") return "summary";
  if (grain === "threeMonths") return "months";
  return "indicators";
}

export const GRAINS: { key: Grain; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "fortnight", label: "Bi-weekly" },
  { key: "month", label: "Month" },
  { key: "threeMonths", label: "Three months" },
  { key: "year", label: "Year" },
];

export { spanFor, daysIn, monthsIn, type Span, type Grain };

const cash = (c: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(c / 100);
const hrs = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const clock = (s: string) => new Date(s).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" });
const dayNum = (k: string) => Number(k.slice(8, 10));
const weekday = (k: string) => new Date(`${k}T12:00:00`).toLocaleDateString("en-CA", { weekday: "short" });

/** One day in full: every shift, expense, trip and note on it. */
function fullDay(key: string, t: DayTally | undefined, name: (id: string) => string): string {
  if (!t || (!t.shifts.length && !t.expenses.length && !t.trips.length && !t.notes.length)) {
    return `<div class="cal-day empty-day"><b>${weekday(key)} ${dayNum(key)}</b><span class="sub">nothing</span></div>`;
  }
  return `<div class="cal-day${t.incident ? " incident" : ""}">
    <b>${weekday(key)} ${dayNum(key)}</b>
    ${t.shifts.map((s) => `<span class="ev shift">${clock(s.startAt)}${s.endAt ? `\u2013${clock(s.endAt)}` : " running"} \u00b7 ${s.participants.map((p) => name(p.clientId)).join(", ")}</span>`).join("")}
    ${t.expenses.map((e) => `<span class="ev exp">${e.description} ${cash(e.totalAmount)}</span>`).join("")}
    ${t.trips.map((p) => `<span class="ev trip">${p.purpose} ${p.distance}${p.distanceUnit}</span>`).join("")}
    ${t.notes.map((n) => `<span class="ev note">${n.body.slice(0, 40)}</span>`).join("")}
    ${t.minutes || t.money ? `<span class="sub">${hrs(t.minutes)} \u00b7 ${cash(t.money)}</span>` : ""}
  </div>`;
}

/** One day as a figure: how long, how much, and whether anything happened. */
function summaryDay(key: string, t: DayTally | undefined): string {
  const has = t && (t.minutes || t.money || t.shifts.length);
  return `<div class="cal-cell${has ? " has" : ""}${t?.incident ? " incident" : ""}">
    <b>${dayNum(key)}</b>
    ${has ? `<span>${hrs(t!.minutes)}</span><span class="sub">${cash(t!.money)}</span>` : ""}
  </div>`;
}

/**
 * The calendar at whatever zoom is chosen. Detail falls away as the span grows:
 * a fortnight of full entries is unreadable, and a year of them is meaningless,
 * so each level shows the most that still fits.
 */
/** A month as a full day grid, used on its own and stacked three at a time. */
function monthGrid(from: string, to: string, label: string, tally: Map<string, DayTally>): string {
  const days: string[] = [];
  for (let k = from; k <= to; ) {
    days.push(k);
    const d = new Date(`${k}T12:00:00`);
    d.setDate(d.getDate() + 1);
    k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  const lead = (new Date(`${days[0]}T12:00:00`).getDay() + 6) % 7;
  const t = sumRange(tally, from, to);
  return `<div class="cal-month-block">
    <h4>${label}<span class="sub">${t.shifts.length ? `${t.shifts.length} shift${t.shifts.length === 1 ? "" : "s"} · ${hrs(t.minutes)} · ${cash(t.money)}` : "nothing recorded"}</span></h4>
    <div class="cal-grid">
      ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<div class="cal-head">${d}</div>`).join("")}
      ${Array.from({ length: lead }, () => `<div class="cal-cell blank"></div>`).join("")}
      ${days.map((k) => summaryDay(k, tally.get(k))).join("")}
    </div>
  </div>`;
}

/**
 * The calendar at whatever zoom is chosen. Detail falls away as the span grows,
 * because a season of full entries is unreadable - but every level still shows
 * real days rather than a summary standing in for them.
 */
export function renderCalendar(span: Span, tally: Map<string, DayTally>, name: (id: string) => string): string {
  const detail = detailFor(span.grain);

  if (span.grain === "day") {
    return `<div class="cal-list">${fullDay(span.from, tally.get(span.from), name)}</div>`;
  }

  if (detail === "everything") {
    return `<div class="cal-week">${daysIn(span).map((k) => fullDay(k, tally.get(k), name)).join("")}</div>`;
  }

  if (detail === "twoWeeks") {
    // Both weeks in full, stacked, with THIS week on top: it is the one being
    // worked, so it carries the detail. Last week sits under it, smaller,
    // because it is for checking rather than working from.
    const all = daysIn(span);
    const first = all.slice(7);   // this week
    const second = all.slice(0, 7); // last week
    const sum = (ds: string[]) => sumRange(tally, ds[0], ds[ds.length - 1]);
    const a = sum(first);
    const b = sum(second);
    return `<div class="cal-fortnight">
      <div class="fn-week current">
        <h4>This week<span class="sub">${a.shifts.length ? `${hrs(a.minutes)} · ${cash(a.money)}` : "nothing"}</span></h4>
        <div class="cal-week">${first.map((k) => fullDay(k, tally.get(k), name)).join("")}</div>
      </div>
      <div class="fn-week earlier">
        <h4>Last week<span class="sub">${b.shifts.length ? `${hrs(b.minutes)} · ${cash(b.money)}` : "nothing"}</span></h4>
        <div class="cal-week">${second.map((k) => fullDay(k, tally.get(k), name)).join("")}</div>
      </div>
    </div>`;
  }

  if (detail === "summary" || detail === "months") {
    // One month, or three stacked at the same size - each a real grid of days,
    // not a chip standing in for a month.
    // Most recent first: this month on top, then back through the previous two.
    return `<div class="cal-stack">${[...monthsIn(span)].reverse().map((m) => monthGrid(m.from, m.to, `${m.label} ${m.from.slice(0, 4)}`, tally)).join("")}</div>`;
  }

  const months = monthsIn(span).map((m) => ({ ...m, t: sumRange(tally, m.from, m.to) }));
  const peak = Math.max(1, ...months.map((m) => m.t.minutes));
  return `<div class="cal-year">${months.map((m) => `<div class="cal-bar">
      <div class="bar"><div class="fill${m.t.incident ? " incident" : ""}" style="height:${Math.round((m.t.minutes / peak) * 100)}%"></div></div>
      <b>${m.label.slice(0, 3)}</b>
      <span class="sub">${m.t.minutes ? hrs(m.t.minutes) : "—"}</span>
      <span class="sub">${m.t.money ? cash(m.t.money) : ""}</span>
    </div>`).join("")}</div>`;
}
