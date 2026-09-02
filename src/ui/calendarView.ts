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
export function detailFor(grain: Grain): "everything" | "summary" | "chips" | "indicators" {
  if (grain === "day" || grain === "week") return "everything";
  if (grain === "fortnight" || grain === "month") return "summary";
  if (grain === "twoMonths") return "chips";
  return "indicators";
}

export const GRAINS: { key: Grain; label: string }[] = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "fortnight", label: "Fortnight" },
  { key: "month", label: "Month" },
  { key: "twoMonths", label: "Two months" },
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
export function renderCalendar(span: Span, tally: Map<string, DayTally>, name: (id: string) => string): string {
  const detail = detailFor(span.grain);
  const days = span.grain === "year" || span.grain === "twoMonths" ? [] : daysIn(span);

  if (span.grain === "day") {
    return `<div class="cal-list">${fullDay(span.from, tally.get(span.from), name)}</div>`;
  }

  if (detail === "everything") {
    return `<div class="cal-week">${days.map((k) => fullDay(k, tally.get(k), name)).join("")}</div>`;
  }

  if (detail === "summary") {
    // Pad so the first day lands under its weekday.
    const lead = (new Date(`${days[0]}T12:00:00`).getDay() + 6) % 7;
    return `<div class="cal-grid">
      ${["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => `<div class="cal-head">${d}</div>`).join("")}
      ${Array.from({ length: lead }, () => `<div class="cal-cell blank"></div>`).join("")}
      ${days.map((k) => summaryDay(k, tally.get(k))).join("")}
    </div>`;
  }

  if (detail === "chips") {
    return `<div class="cal-months">${monthsIn(span).map((m) => {
      const t = sumRange(tally, m.from, m.to);
      const worked = t.shifts.length;
      return `<div class="cal-month">
        <h4>${m.label}</h4>
        ${worked ? `<span class="chip">${worked} shift${worked === 1 ? "" : "s"}</span>
          <span class="chip">${hrs(t.minutes)}</span>
          <span class="chip money">${cash(t.money)}</span>
          ${t.expenses.length ? `<span class="chip">${t.expenses.length} expense${t.expenses.length === 1 ? "" : "s"}</span>` : ""}
          ${t.trips.length ? `<span class="chip">${t.trips.length} trip${t.trips.length === 1 ? "" : "s"}</span>` : ""}
          ${t.incident ? `<span class="chip warn">incident</span>` : ""}`
        : `<span class="sub">nothing recorded</span>`}
      </div>`;
    }).join("")}</div>`;
  }

  // A year: one bar per month, scaled against the busiest, so the shape of the
  // year reads at a glance without any figures to compare.
  const months = monthsIn(span).map((m) => ({ ...m, t: sumRange(tally, m.from, m.to) }));
  const peak = Math.max(1, ...months.map((m) => m.t.minutes));
  return `<div class="cal-year">${months.map((m) => `<div class="cal-bar">
      <div class="bar"><div class="fill${m.t.incident ? " incident" : ""}" style="height:${Math.round((m.t.minutes / peak) * 100)}%"></div></div>
      <b>${m.label.slice(0, 3)}</b>
      <span class="sub">${m.t.minutes ? hrs(m.t.minutes) : "\u2014"}</span>
      <span class="sub">${m.t.money ? cash(m.t.money) : ""}</span>
    </div>`).join("")}</div>`;
}
