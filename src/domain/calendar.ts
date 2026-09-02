export type Grain = "day" | "week" | "fortnight" | "month" | "threeMonths" | "year";

export interface Span {
  /** Local YYYY-MM-DD, inclusive. */
  from: string;
  to: string;
  label: string;
  grain: Grain;
}

/**
 * The local calendar day an instant falls on.
 *
 * Records are stored as UTC, but a shift belongs to the day the worker lived,
 * not the day in Greenwich. An evening shift in Vancouver is already tomorrow
 * in UTC, so grouping on the raw string would file it under the wrong date and
 * quietly move work between weeks - and between invoices.
 */
export function dayKey(iso: string, zone?: string): string {
  return new Date(iso).toLocaleDateString("en-CA", zone ? { timeZone: zone } : undefined);
}

const asDate = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const asKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (key: string, n: number) => {
  const d = asDate(key);
  d.setDate(d.getDate() + n);
  return asKey(d);
};

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

/** Monday-first, because a support week is worked and invoiced that way. */
function startOfWeek(key: string): string {
  const d = asDate(key);
  const shift = (d.getDay() + 6) % 7;
  return addDays(key, -shift);
}

/**
 * The span containing `anchor` at this zoom, with a label a person would
 * recognise. Every span is inclusive at both ends.
 */
export function spanFor(anchor: string, grain: Grain): Span {
  const d = asDate(anchor);
  const year = d.getFullYear();

  if (grain === "day") {
    return { from: anchor, to: anchor, grain, label: asDate(anchor).toLocaleDateString("en-CA", { weekday: "long", day: "numeric", month: "long", year: "numeric" }) };
  }
  if (grain === "week") {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6), grain, label: `Week of ${asDate(from).toLocaleDateString("en-CA", { day: "numeric", month: "long", year: "numeric" })}` };
  }
  if (grain === "fortnight") {
    // Looks BACK: this week and the one before it. What was worked matters more
    // than what is scheduled - the week ahead is usually empty anyway.
    const thisWeek = startOfWeek(anchor);
    const from = addDays(thisWeek, -7);
    const to = addDays(thisWeek, 6);
    return { from, to, grain, label: `Two weeks to ${asDate(to).toLocaleDateString("en-CA", { day: "numeric", month: "long", year: "numeric" })}` };
  }
  if (grain === "month") {
    const from = `${year}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const to = asKey(new Date(year, d.getMonth() + 1, 0));
    return { from, to, grain, label: `${MONTHS[d.getMonth()]} ${year}` };
  }
  if (grain === "threeMonths") {
    // This month and the two before it, not a fixed quarter: on the 1st of a
    // quarter a fixed window would show almost nothing that had been worked.
    const start = new Date(year, d.getMonth() - 2, 1);
    const from = asKey(start);
    const to = asKey(new Date(year, d.getMonth() + 1, 0));
    return { from, to, grain, label: `${MONTHS[start.getMonth()]} to ${MONTHS[d.getMonth()]} ${d.getMonth() < start.getMonth() ? "" : year}`.trim() };
  }
  return { from: `${year}-01-01`, to: `${year}-12-31`, grain, label: `${year}` };
}

/** The same zoom, moved by `steps` spans. */
export function step(anchor: string, grain: Grain, steps: number): string {
  const d = asDate(anchor);
  if (grain === "day") return addDays(anchor, steps);
  if (grain === "week") return addDays(anchor, 7 * steps);
  if (grain === "fortnight") return addDays(anchor, 14 * steps);
  if (grain === "month") return asKey(new Date(d.getFullYear(), d.getMonth() + steps, 1));
  if (grain === "threeMonths") return asKey(new Date(d.getFullYear(), d.getMonth() + 3 * steps, 1));
  return asKey(new Date(d.getFullYear() + steps, d.getMonth(), 1));
}

/** Every local day in a span, in order. */
export function daysIn(span: Span): string[] {
  const out: string[] = [];
  for (let k = span.from; k <= span.to; k = addDays(k, 1)) out.push(k);
  return out;
}

export const inSpan = (key: string, span: Span) => key >= span.from && key <= span.to;

/** Whole months in a span, for the zoomed-out views. */
export function monthsIn(span: Span): { key: string; label: string; from: string; to: string }[] {
  const out: { key: string; label: string; from: string; to: string }[] = [];
  const first = asDate(span.from);
  const last = asDate(span.to);
  const d = new Date(first.getFullYear(), first.getMonth(), 1);
  while (d <= last) {
    const from = asKey(d);
    const to = asKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
    out.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: MONTHS[d.getMonth()], from, to });
    d.setMonth(d.getMonth() + 1);
  }
  return out;
}

export const todayKey = () => asKey(new Date());
