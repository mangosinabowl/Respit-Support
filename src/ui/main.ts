import "./style.css";
import { RespiteDb, appendEvent, hydrate, nextSeq, deviceId, exportEventLog, importEventLog } from "../store/db";
import { makeEvent, type DomainEvent } from "../domain/events";
import { live, type replay } from "../domain/replay";
import { owedByPayer } from "../domain/queries";
import { clientsVisibleTo, filterShiftFor, filterExpenseFor, type AudienceContext } from "../domain/audience";
import { buildInvoice, type Invoice } from "../domain/invoice";
import { printInvoices } from "./invoicePrint";
import { expenseAsMinutes, splitByPercent } from "../domain/expenseTime";
import { tripShares } from "../domain/mileage";
import { checkShift, checkExpense, checkTrip, isSubmittable, type Violation } from "../domain/invariants";
import { shrinkImage, readableSize } from "./photo";
import { exportAll } from "../domain/backup";
import { syncOnce } from "../store/sync";
import { connectDrive, driveRemote } from "../store/googleDrive";
import { newId, nowInstant } from "../domain/primitives";
import { splitShiftAt, mergeShifts } from "../domain/operations";
import type { Shift, Expense, Client, Trip, Note, Attachment, Adjustment } from "../domain/entities";

const db = new RespiteDb();
const dev = deviceId();
const app = document.getElementById("app")!;

const money = (c: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(c / 100);
const hhmm = (s: string) => new Date(s).toLocaleTimeString("en-CA", { hour: "2-digit", minute: "2-digit" });
const day = (s: string) => new Date(s).toLocaleDateString("en-CA", { month: "short", day: "numeric" });
const forInput = (s: string) => { const d = new Date(s); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const fromInput = (v: string) => new Date(v).toISOString();
const mins = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000));
const dur = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

/** Purely visual state: what is expanded, what is being edited, how lists are sorted. */
const ui = {
  openShift: null as string | null,
  editing: null as string | null,
  msg: "",
  confirm: null as { kind: string; id: string; label: string; what: string } | null,
  /** Who a new expense is for, by client id, and each one's percentage share. */
  expFor: {} as Record<string, number>,
  /** Kept across re-renders so ticking a person does not wipe what was typed. */
  draft: { desc: "", amt: "" },
  tripFor: {} as Record<string, number>,
  /** Shares being edited on an existing expense, seeded from what it already has. */
  editSplit: {} as Record<string, number>,
  tripDraft: { km: "", purpose: "", rate: "" },
  sync: {
    token: null as string | null,
    busy: false,
    note: "",
    /** Set when Google refuses silently, so we ask rather than popping windows. */
    needsConnect: false,
  },
  view: { as: "me", clientId: "" } as { as: "me" | "guardian" | "payer" | "archived"; clientId: string },
  sort: { shifts: { key: "startAt", dir: -1 }, expenses: { key: "occurredAt", dir: -1 }, owed: { key: "unclaimed", dir: -1 } },
};

async function emit(type: Parameters<typeof makeEvent>[0], id: string, fields: Record<string, unknown>) {
  await appendEvent(db, makeEvent(type, id, fields, dev, await nextSeq(db, dev)));
  syncSoon();
}
async function emitAll(events: DomainEvent[]) { for (const e of events) await appendEvent(db, e); }

/** Soft delete. The record stays in the log; it just stops being live. */
const remove = (type: Parameters<typeof makeEvent>[0], id: string) => emit(type, id, { deleted: true });

function sorted<T>(rows: T[], s: { key: string; dir: number }): T[] {
  return [...rows].sort((a, b) => {
    const x = (a as any)[s.key], y = (b as any)[s.key];
    if (x === y) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (typeof x === "number" ? x - y : String(x).localeCompare(String(y))) * s.dir;
  });
}
const RULE_LABEL: Record<string, string> = {
  fullPerPayer: "pays the full hour",
  splitEvenly: "splits with other splitters",
};
const ruleSelect = (id: string, value: string) =>
  `<select id="${id}" style="max-width:200px"${id.startsWith("rule-") ? ` data-rule="${id}"` : ""}>
     <option value="fullPerPayer"${value === "fullPerPayer" ? " selected" : ""}>Pays the full hour</option>
     <option value="splitEvenly"${value === "splitEvenly" ? " selected" : ""}>Splits the hour</option>
   </select>`;

/**
 * Google's sign-in lapses roughly 7 days after connecting while the app is in
 * testing. The app already tracks time, so it can say so before sync quietly
 * stops rather than after.
 */
const CONNECT_KEY = "respite.driveConnectedAt";
const LAST_SYNC_KEY = "respite.lastSyncAt";
const TOKEN_LIFE_DAYS = 7;

function stamp(key: string) { try { localStorage.setItem(key, new Date().toISOString()); } catch { /* storage blocked */ } }
function readStamp(key: string): Date | null {
  try { const v = localStorage.getItem(key); return v ? new Date(v) : null; } catch { return null; }
}
const daysSince = (d: Date | null) => (d ? (Date.now() - d.getTime()) / 86400000 : Infinity);

function agoText(d: Date | null): string {
  if (!d) return "never";
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/** How close the Google connection is to lapsing, in plain words. */
function connectionWarning(): { text: string; urgent: boolean } | null {
  const connected = readStamp(CONNECT_KEY);
  if (!connected) return null;
  const left = TOKEN_LIFE_DAYS - daysSince(connected);
  if (left <= 0) return { text: "Google sign-in has lapsed. Press Connect to sync again.", urgent: true };
  if (left <= 2) {
    const hours = Math.round(left * 24);
    return { text: `Google sign-in lapses in about ${hours < 24 ? `${hours} hours` : "a day"}. Reconnect when convenient.`, urgent: true };
  }
  return { text: `Google sign-in good for about ${Math.floor(left)} more days.`, urgent: false };
}

/**
 * Problems worth showing. The checks have always existed and were never run,
 * so a record could be unclaimable without anything saying so until a payer
 * queried it.
 */
function problems(list: Violation[]): string {
  if (!list.length) return "";
  return `<p class="flag">${list.map((v) => v.message).join(" · ")}</p>`;
}

const TRASH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;

/** A trash button that asks before it acts. */
const trash = (kind: string, id: string, label: string, what: string) =>
  `<button class="trash" title="Delete" data-ask="${kind}|${id}|${encodeURIComponent(label)}|${encodeURIComponent(what)}">${TRASH}</button>`;

const arrow = (s: { key: string; dir: number }, k: string) => s.key === k ? `<span class="ar">${s.dir > 0 ? "\u25B2" : "\u25BC"}</span>` : "";


/**
 * One sync attempt. `interactive` decides whether we may open a sign-in window:
 * automatic runs must never do that, or the app would pop windows at the user
 * while they are trying to log a shift.
 */
async function runSync(interactive: boolean) {
  if (ui.sync.busy) return;
  ui.sync.busy = true;
  if (interactive) { ui.sync.note = ""; render(); }
  try {
    if (!ui.sync.token) {
      // Try to get a token without a prompt first; only ask if allowed to.
      try {
        ui.sync.token = await connectDrive(false);
        stamp(CONNECT_KEY);
      } catch {
        if (!interactive) { ui.sync.needsConnect = true; return; }
        ui.sync.token = await connectDrive(true);
        stamp(CONNECT_KEY);
      }
    }
    const remote = driveRemote(async () => ui.sync.token!);
    const r = await syncOnce(db, remote, dev);
    stamp(LAST_SYNC_KEY);
    ui.sync.needsConnect = false;
    const others = r.devicesSeen.length;
    ui.sync.note = `Published ${r.pushed}, took in ${r.pulled}, already had ${r.skipped}. `
      + (others ? `${others} other device${others === 1 ? "" : "s"} seen.` : "No other devices yet.")
      + (r.conflicts.length ? ` ${r.conflicts.length} kept back as conflicts.` : "");
  } catch (err: any) {
    // A lapsed token looks like a refusal from Drive. Clear it so the next
    // attempt signs in again, and say so rather than failing silently - a sync
    // that stopped a week ago is worse than one you knew had stopped.
    ui.sync.token = null;
    ui.sync.needsConnect = true;
    ui.sync.note = `Sync failed: ${err.message}. Press Connect Google Drive.`;
  } finally {
    ui.sync.busy = false;
    render();
  }
}

let syncTimer: ReturnType<typeof setTimeout> | undefined;
/** Called after a change: waits for the flurry to finish, then publishes. */
function syncSoon() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { void runSync(false); }, 8000);
}

async function render() {
  const store = await hydrate(db);
  const everyone = live(store, "client") as unknown as Client[];
  // Archived people stay in `everyone` so their name still resolves on money
  // they are owed; only `clients` is offered for new work.
  const clients = everyone.filter((c) => !c.archived);
  const archived = everyone.filter((c) => c.archived);
  const shiftsAll = live(store, "shift") as unknown as Shift[];
  const allExpenses = live(store, "expense") as unknown as Expense[];
  const allTrips = live(store, "trip") as unknown as Trip[];
  const notes = live(store, "note") as unknown as Note[];
  const attachments = live(store, "attachment") as unknown as Attachment[];
  const adjustments = live(store, "adjustment") as unknown as Adjustment[];
  const trips = allTrips.filter((t) => !t.archived && t.reimbursementStatus !== "paid");
  // Archived records and settled expenses drop out of the working views but
  // stay in every total, and stay restorable.
  const allShifts = shiftsAll.filter((s) => !s.archived);
  const expenses = allExpenses.filter((e) => !e.archived && e.reimbursementStatus !== "paid");
  const open = allShifts.find((s) => !s.endAt);
  const done = allShifts.filter((s) => s.endAt);
  const owed = owedByPayer(store);
  const name = (id: string) => everyone.find((c) => c.id === id)?.name ?? "—";

  const totalMins = done.reduce((t, s) => t + s.participants.reduce((m, p) => Math.max(m, mins(p.inAt, p.outAt)), 0), 0);
  const totalOwed = owed.reduce((t, r) => t + r.unclaimed, 0);

  const shiftRows = sorted(done.map((s) => ({
    id: s.id, startAt: s.startAt, endAt: s.endAt!, people: s.participants.map((p) => name(p.clientId)).join(", "),
    minutes: s.participants.reduce((m, p) => Math.max(m, mins(p.inAt, p.outAt)), 0),
    pay: s.participants.reduce((t, p) => t + Math.round(mins(p.inAt, p.outAt) / 60 * p.payRate), 0),
  })), ui.sort.shifts);

  const expRows = sorted(expenses.map((e) => ({
    id: e.id, description: e.description, totalAmount: e.totalAmount, occurredAt: e.occurredAt, shiftId: e.shiftId ?? null,
  })), ui.sort.expenses);

  app.innerHTML = `
    <header><h1>Respite Support</h1><span class="dev">device ${dev.slice(0, 8)}</span></header>
    <section class="card view-${ui.view.as}">
      <h2>Viewing as</h2>
      <div class="row">
        <select id="viewAs" class="view-${ui.view.as}">
          <option value="me"${ui.view.as === "me" ? " selected" : ""}>Me — everything</option>
          <option value="guardian"${ui.view.as === "guardian" ? " selected" : ""}>Guardian — one person only</option>
          <option value="payer"${ui.view.as === "payer" ? " selected" : ""}>Payer — expenses as extra time</option>
          <option value="archived"${ui.view.as === "archived" ? " selected" : ""}>Archived — put away, not gone</option>
        </select>
        ${ui.view.as === "guardian" || ui.view.as === "payer" ? `<select id="viewWho">
          ${clients.map((c) => `<option value="${c.id}"${ui.view.clientId === c.id ? " selected" : ""}>${c.name}</option>`).join("")}
          <option value="__all"${ui.view.clientId === "__all" ? " selected" : ""}>Everyone — one page each</option>
        </select>` : ""}
      </div>
    </section>
    ${ui.view.as === "me" ? ""
      : ui.view.as === "archived" ? archivedView(archived, shiftsAll, allExpenses, owed, name, allTrips)
      : ui.view.clientId === "__all" ? everyoneView(ui.view.as, clients, allShifts, allExpenses, allTrips, adjustments)
      : shareView(ui.view.as, ui.view.clientId || clients[0]?.id || "", allShifts, expenses, everyone, name, trips, notes, store, adjustments)}

    ${ui.view.as !== "me" ? "" : `
    <div class="grid">
      <div class="stat"><b>${dur(totalMins)}</b><span>logged</span></div>
      <div class="stat"><b>${money(totalOwed)}</b><span>unclaimed</span></div>
      <div class="stat"><b>${done.length}</b><span>shifts</span></div>
      <div class="stat"><b>${expenses.length}</b><span>expenses</span></div>
    </div>

    <section class="card ${open ? "live" : ""}">
      <h2>${open ? "Shift running" : "Start a shift"}</h2>
      ${open
        ? `<p class="big">since ${hhmm(open.startAt)} \u00B7 ${dur(mins(open.startAt, nowInstant()))}</p>
           <table><tbody>${open.participants.map((p, i) => {
             const gone = Date.parse(p.outAt) > Date.parse(p.inAt);
             return `<tr><td>${name(p.clientId)}<br><span class="sub">${hhmm(p.inAt)}${gone ? `\u2013${hhmm(p.outAt)}` : " \u2192 still here"} @ ${money(p.payRate)}/hr \u00B7 ${RULE_LABEL[p.timeRule] ?? p.timeRule}</span></td>
               <td class="n">${ruleSelect(`rule-${i}`, p.timeRule)} ${gone ? `<span class="pill">left</span>` : `<button class="tiny ghost" data-left="${i}">Mark left</button>`}</td></tr>`;
           }).join("")}</tbody></table>
           ${clients.filter((c) => !open.participants.some((p) => p.clientId === c.id)).length
             ? `<div class="row"><select id="arrive">${clients.filter((c) => !open.participants.some((p) => p.clientId === c.id)).map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}</select>
                <input id="arate" type="number" value="${((clients.filter((c) => !open.participants.some((p) => p.clientId === c.id))[0].defaultRate ?? 0) / 100).toFixed(2)}" step="0.5" style="max-width:110px" />
                <button class="pink" id="addp">Someone arrived</button></div>`
             : ""}
           <p class="sub">Each person settles their own way. Time is shared only between the people set to split — anyone on the full hour is not counted in that split.</p>
           <div class="acts"><button id="end" class="primary">End shift</button>
           ${trash("shift", open.id, `the shift running since ${hhmm(open.startAt)}`, "shift")}</div>`
        : clients.length
          ? `<label>Who are you with?</label>
             <select id="who">${clients.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}</select>
             <label>Rate $/hr (CAD)</label><input id="rate" type="number" value="${((clients[0].defaultRate ?? 0) / 100).toFixed(2)}" step="0.5" />
             <p class="sub">Their own standing rate, and it is snapshotted onto this shift. Change it under People to change it from now on.</p>
             <button id="start" class="primary">Start shift</button>`
          : `<p class="empty">Add someone you support first.</p>`}
    </section>

    <section class="card">
      <h2>Log a past shift</h2>
      ${clients.length ? `<p class="sub">For a shift you did not time on the day. Add anyone else who was there, with their own hours, once it is created.</p>
      <div class="row">
        <select id="pastWho">${clients.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}</select>
        <input id="pastFrom" type="datetime-local" title="Started" />
        <input id="pastTo" type="datetime-local" title="Ended" />
        <button id="logPast" class="ghost">Log it</button>
      </div>` : `<p class="empty">Add someone you support first.</p>`}
    </section>

    <section class="card">
      <h2>People</h2>
      <table><tbody>
        ${clients.map((c) => ui.editing === c.id
          ? `<tr><td colspan="2"><div class="row"><input id="ren" value="${c.name}" />
               <input id="rrate" type="number" step="0.5" style="max-width:110px" value="${((c.defaultRate ?? 0) / 100).toFixed(2)}" title="Hourly rate" />
               ${ruleSelect("rrule", c.defaultTimeRule ?? "fullPerPayer")}
               <button class="tiny" data-save-client="${c.id}">Save</button>
               <button class="tiny ghost" data-cancel="1">Cancel</button></div>
               <p class="sub" style="margin:6px 0 0">Changing the rate only affects shifts you log from now on. Shifts already recorded keep the rate they were logged at.</p></td></tr>`
          : `<tr><td>${c.name}<br><span class="sub">${(c.defaultRate ?? 0) === 0 ? "not billed" : `${money(c.defaultRate ?? 0)}/hr · ${RULE_LABEL[c.defaultTimeRule ?? "fullPerPayer"]}`}</span></td><td class="n">
               <button class="tiny ghost" data-edit="${c.id}">Edit</button>
               <button class="tiny ghost" data-archive="${c.id}">Archive</button></td></tr>`).join("")
          || `<tr><td class="empty">Nobody yet</td></tr>`}
      </tbody></table>
      <div class="row"><input id="cname" placeholder="Name" /><input id="crate" type="number" step="0.5" value="0.00" style="max-width:120px" title="Hourly rate" /><button id="addc">Add</button></div>
    </section>

    <section class="card">
      <h2>Shifts</h2>
      ${shiftRows.length ? `<table>
        <tr><th data-sort="shifts:startAt">When ${arrow(ui.sort.shifts, "startAt")}</th>
            <th data-sort="shifts:people">Who ${arrow(ui.sort.shifts, "people")}</th>
            <th class="n" data-sort="shifts:minutes">Time ${arrow(ui.sort.shifts, "minutes")}</th>
            <th class="n" data-sort="shifts:pay">Pay ${arrow(ui.sort.shifts, "pay")}</th></tr>
        ${shiftRows.map((r) => `<tr class="click ${ui.openShift === r.id ? "open" : ""}" data-shift="${r.id}">
            <td>${day(r.startAt)} ${hhmm(r.startAt)}\u2013${hhmm(r.endAt)}</td>
            <td>${r.people}${problems(checkShift(allShifts.find((s) => s.id === r.id)!))}</td>
            <td class="n">${dur(r.minutes)}</td><td class="n">${money(r.pay)}</td></tr>`).join("")}
      </table>` : `<p class="empty">No finished shifts yet.</p>`}
      ${ui.openShift ? shiftDetail(allShifts.find((s) => s.id === ui.openShift)!, expenses, done, name, clients, notes) : ""}
    </section>

    <section class="card">
      <h2>Expenses</h2>
      ${expRows.length ? `<table>
        <tr><th data-sort="expenses:description">What ${arrow(ui.sort.expenses, "description")}</th>
            <th data-sort="expenses:occurredAt">When ${arrow(ui.sort.expenses, "occurredAt")}</th>
            <th class="n" data-sort="expenses:totalAmount">Amount ${arrow(ui.sort.expenses, "totalAmount")}</th>
            <th></th></tr>
        ${expRows.map((e) => ui.editing === e.id
          ? `<tr><td colspan="4"><div class="row">
               <input id="ed" value="${e.description}" />
               <input id="ea" type="number" step="0.01" value="${(e.totalAmount / 100).toFixed(2)}" style="max-width:120px" />
               <button class="tiny" data-save-exp="${e.id}">Save</button>
               <button class="tiny ghost" data-cancel="1">Cancel</button></div>
               <p class="sub" style="margin:8px 0 4px">Who it was for. Shares must add up to 100%.</p>
               <table><tbody>${clients.map((c) => {
                 const existing = (expenses.find((x) => x.id === e.id)?.splits ?? []).find((sp) => sp.clientId === c.id);
                 const pct = ui.editSplit[c.id];
                 const on = pct !== undefined;
                 return `<tr><td style="width:26px"><input type="checkbox" data-efor="${c.id}" ${on ? "checked" : ""} style="width:auto" /></td>
                   <td>${c.name}${existing ? `<span class="sub"> was ${money(existing.amount)}</span>` : ""}</td>
                   <td class="n" style="width:110px">${on ? `<input type="number" data-epct="${c.id}" value="${pct.toFixed(1)}" step="0.1" style="max-width:90px" />%` : `<span class="sub">not included</span>`}</td></tr>`;
               }).join("")}</tbody></table></td></tr>`
          : `<tr><td>${e.description}<br><span class="sub">${(expenses.find((x) => x.id === e.id)?.splits ?? [])
                 .map((sp) => `${name(sp.clientId)} ${money(sp.amount)}`).join(" · ") || "nobody"}</span>
               ${(() => {
                 const ex = expenses.find((x) => x.id === e.id)!;
                 const shots = attachments.filter((a) => ex.receiptAttachmentIds.includes(a.id));
                 return `<div class="receipts">${shots.map((a) => `<span class="shot"><img src="${a.dataUrl}" alt="Receipt" />
                     <button class="tiny ghost" data-unshot="${ex.id}:${a.id}">Remove</button></span>`).join("")}
                   <label class="file tiny">${shots.length ? "Add another" : "Add receipt"}<input type="file" accept="image/*" capture="environment" data-shot="${ex.id}" hidden /></label></div>`;
               })()}
               ${problems(checkExpense(expenses.find((x) => x.id === e.id)!))}</td>
             <td>${day(e.occurredAt)}</td><td class="n">${money(e.totalAmount)}</td>
             <td class="n"><button class="tiny ghost" data-edit="${e.id}">Edit</button>
             <button class="tiny ghost" data-paid="${e.id}">Mark paid</button>
             ${trash("expense", e.id, `${e.description} (${money(e.totalAmount)})`, "expense")}</td></tr>`).join("")}
      </table>` : `<p class="empty">None yet.</p>`}
      <div class="row"><input id="edesc" placeholder="What for?" value="${ui.draft.desc}" /><input id="eamt" type="number" placeholder="0.00" step="0.01" style="max-width:130px" value="${ui.draft.amt}" /></div>
      ${clients.length ? `<p class="sub" style="margin:10px 0 4px">Who was it for? Shares must add up to 100%.</p>
      <table><tbody>${clients.map((c) => {
        const on = ui.expFor[c.id] !== undefined;
        return `<tr><td style="width:26px"><input type="checkbox" data-for="${c.id}" ${on ? "checked" : ""} style="width:auto" /></td>
          <td>${c.name}</td>
          <td class="n" style="width:110px">${on ? `<input type="number" data-pct="${c.id}" value="${ui.expFor[c.id].toFixed(1)}" step="0.1" style="max-width:90px" />%` : `<span class="sub">not included</span>`}</td>
          <td class="n" style="width:90px"><span class="sub" id="pv-${c.id}"></span></td></tr>`;
      }).join("")}</tbody></table>
      <p class="sub" id="pcttotal"></p>` : ""}
      <div class="row"><button id="adde">Add expense</button></div>
    </section>

    <section class="card">
      <h2>Mileage</h2>
      ${clients.length ? `<div class="row">
        <input id="tkm" type="number" step="0.1" placeholder="Distance" value="${ui.tripDraft.km}" style="max-width:120px" />
        <select id="tunit" style="max-width:80px"><option value="km">km</option><option value="mi">mi</option></select>
        <input id="tpurpose" placeholder="Where to?" value="${ui.tripDraft.purpose}" />
        <input id="trate" type="number" step="0.01" placeholder="c/unit" value="${ui.tripDraft.rate}" style="max-width:110px" title="cents per km/mi" />
      </div>
      <p class="sub" style="margin:10px 0 4px">Who was in the car? Shares must add up to 100%.</p>
      <table><tbody>${clients.map((c) => {
        const on = ui.tripFor[c.id] !== undefined;
        return `<tr><td style="width:26px"><input type="checkbox" data-tfor="${c.id}" ${on ? "checked" : ""} style="width:auto" /></td>
          <td>${c.name}</td>
          <td class="n" style="width:110px">${on ? `<input type="number" data-tpct="${c.id}" value="${ui.tripFor[c.id].toFixed(1)}" step="0.1" style="max-width:90px" />%` : `<span class="sub">not carried</span>`}</td>
          <td class="n" style="width:90px"><span class="sub" id="tv-${c.id}"></span></td></tr>`;
      }).join("")}</tbody></table>
      <p class="sub" id="tpcttotal"></p>
      <div class="row"><button id="addTrip">Log trip</button></div>
      <p class="sub">Fuel at the pump is not claimed - mileage already covers running the car, so claiming both would bill the same cost twice.</p>
      ${trips.length ? `<table style="margin-top:10px">
        ${trips.map((t) => `<tr><td>${t.purpose || "Trip"}<br><span class="sub">${day(t.occurredAt)} · ${t.distance}${t.distanceUnit} · ${t.splits.map((sp) => `${name(sp.clientId)} ${money(sp.claimAmount)}`).join(" · ")}</span>${problems(checkTrip(t))}</td>
          <td class="n">${money(t.splits.reduce((a, sp) => a + sp.claimAmount, 0))}</td>
          <td class="n">${trash("trip", t.id, `${t.purpose || "Trip"} (${t.distance}${t.distanceUnit})`, "trip")}</td></tr>`).join("")}
      </table>` : `<p class="empty">No trips yet.</p>`}` : `<p class="empty">Add someone you support first.</p>`}
    </section>

    <section class="card">
      <h2>Owed</h2>
      ${owed.length ? `<table>
        <tr><th data-sort="owed:payerPartyId">Payer ${arrow(ui.sort.owed, "payerPartyId")}</th>
            <th></th>
            <th class="n" data-sort="owed:unclaimed">Unclaimed ${arrow(ui.sort.owed, "unclaimed")}</th>
            <th class="n" data-sort="owed:submitted">Submitted ${arrow(ui.sort.owed, "submitted")}</th>
            <th class="n" data-sort="owed:paid">Paid ${arrow(ui.sort.owed, "paid")}</th><th></th></tr>
        ${sorted(owed, ui.sort.owed).map((r) => {
          const src = [["Time", r.time], ["Expenses", r.expenses], ["Mileage", r.mileage]] as const;
          return `<tr><td><b>${name(r.payerPartyId.replace(/^payer-/, ""))}</b></td>
              <td class="sub">total</td>
              <td class="n"><b>${money(r.unclaimed)}</b></td><td class="n"><b>${money(r.submitted)}</b></td><td class="n"><b>${money(r.paid)}</b></td>
              <td class="n">${r.unclaimed ? `<button class="tiny ghost" data-submit="${r.payerPartyId}">Mark sent</button>` : ""}${r.submitted ? `<button class="tiny pink" data-settle="${r.payerPartyId}">Mark paid</button>` : ""}</td></tr>
            ${src.filter(([, t]) => t.unclaimed || t.submitted || t.paid).map(([label, t]) =>
              `<tr><td></td><td class="sub">${label}</td>
                 <td class="n sub">${money(t.unclaimed)}</td><td class="n sub">${money(t.submitted)}</td><td class="n sub">${money(t.paid)}</td><td></td></tr>`).join("")}`;
        }).join("")}
      </table>` : `<p class="empty">Nothing owed yet.</p>`}
    </section>

    <section class="card">
      <h2>Sync</h2>
      <p class="sub">Every device keeps its own copy and writes its own file to your Drive, in a folder only this app can see. It syncs on its own — when you open it, a few seconds after you change something, every few minutes while open, and when the connection comes back.</p>
      <div class="row">
        <button id="syncNow" ${ui.sync.busy ? "disabled" : ""}>${ui.sync.busy ? "Syncing…" : "Sync now"}</button>
        <button id="connectDrive" class="pink">${ui.sync.token ? "Reconnect Google" : "Connect Google Drive"}</button>
      </div>
      <p class="sub">Last synced ${agoText(readStamp(LAST_SYNC_KEY))}.</p>
      ${(() => { const w = connectionWarning(); return w ? `<p class="${w.urgent ? "msg urgent" : "sub"}">${w.text}</p>` : ""; })()}
      <p class="msg">${ui.sync.note}</p>
    </section>

    <section class="card">
      <h2>Backup</h2>
      <p class="sub">A copy you keep yourself, outside Google. Sync already keeps your devices in step — this is for if you lose the last one, or lose the Google account.</p>
      <div class="row"><button id="exp" class="pink">Download a copy</button><label class="file">Merge a copy back in<input id="imp" type="file" accept="application/json" hidden /></label><button id="expReadable" class="ghost">Readable summary</button></div>
      <p class="sub">The copy is the event log and is what a merge reads. The readable summary is a plain list of what it all adds up to — for an accountant, not for merging back.</p>
      <p class="sub">Merging only <b>adds</b> what is missing. It never deletes anything, never overwrites newer work, and cannot undo changes made since the copy was taken. Importing the same file twice does nothing the second time.</p>
      <p class="msg">${ui.msg}</p>
    </section>`}
    ${confirmModal()}`;

  wire(open, clients, done, expenses, allShifts, name, allExpenses, allTrips, adjustments, everyone);
}

/**
 * What one other party sees. A guardian sees their own person's shares as
 * money. A payer sees the same shares expressed as extra time at the rate
 * already agreed for that person - the rate itself is never altered.
 */
/**
 * Put away, not gone. Three separate areas, because they are archived for
 * different reasons and restore differently: people you no longer work with,
 * shifts you have tidied off the list, and expenses that have been paid.
 * Nothing here is deleted, and anything still owed keeps counting in Owed.
 */
function archivedView(people: Client[], shifts: Shift[], expenses: Expense[], owed: ReturnType<typeof owedByPayer>, name: (id: string) => string, trips: Trip[]) {
  const archivedShifts = shifts.filter((s) => s.archived);
  const paidExpenses = expenses.filter((e) => e.archived || e.reimbursementStatus === "paid");
  const archivedTrips = trips.filter((t) => t.archived || t.reimbursementStatus === "paid");
  const nothing = !people.length && !archivedShifts.length && !paidExpenses.length && !archivedTrips.length;

  return `<section class="card view-archived">
    <h2>Archived people</h2>
    <p class="sub">Not offered when starting a shift or splitting an expense. Anything still owed keeps showing in Owed until it is claimed.</p>
    ${people.length ? `<table><tbody>${people.map((c) => {
      const row = owed.find((r) => r.payerPartyId === `payer-${c.id}`);
      const out = row ? row.unclaimed + row.submitted : 0;
      return `<tr><td>${c.name}<br><span class="sub">${out ? `${money(out)} still outstanding` : "nothing outstanding"}</span></td>
        <td class="n"><button class="tiny pink" data-restore="${c.id}">Restore</button></td></tr>`;
    }).join("")}</tbody></table>` : `<p class="empty">Nobody archived.</p>`}
  </section>

  <section class="card view-archived">
    <h2>Archived shifts</h2>
    ${archivedShifts.length ? `<table><tbody>${archivedShifts.map((s) => `<tr>
      <td>${day(s.startAt)} ${hhmm(s.startAt)}${s.endAt ? `–${hhmm(s.endAt)}` : ""}<br>
        <span class="sub">${s.participants.map((p) => name(p.clientId)).join(", ") || "nobody"}</span></td>
      <td class="n"><button class="tiny pink" data-unarch-shift="${s.id}">Restore</button></td></tr>`).join("")}</tbody></table>`
      : `<p class="empty">No archived shifts.</p>`}
  </section>

  <section class="card view-archived">
    <h2>Expenses paid</h2>
    <p class="sub">Settled and out of the way. They stay in the Paid column so the record still adds up.</p>
    ${paidExpenses.length ? `<table><tbody>${paidExpenses.map((e) => `<tr>
      <td>${e.description}<br><span class="sub">${day(e.occurredAt)} · ${e.splits.map((sp) => `${name(sp.clientId)} ${money(sp.amount)}`).join(" · ")}</span></td>
      <td class="n">${money(e.totalAmount)}</td>
      <td class="n"><button class="tiny pink" data-unpaid="${e.id}">Reopen</button></td></tr>`).join("")}</tbody></table>`
      : `<p class="empty">Nothing paid off yet.</p>`}
  </section>
  <section class="card">
    <h2>Mileage settled</h2>
    ${archivedTrips.length ? `<table><tbody>${archivedTrips.map((t) => `<tr>
      <td>${t.purpose || "Trip"}<br><span class="sub">${day(t.occurredAt)} · ${t.distance}${t.distanceUnit}</span></td>
      <td class="n">${money(t.splits.reduce((a, sp) => a + sp.claimAmount, 0))}</td>
      <td class="n"><button class="tiny pink" data-untrip="${t.id}">Reopen</button></td></tr>`).join("")}</tbody></table>`
      : `<p class="empty">No settled trips.</p>`}
  </section>
  ${nothing ? `<section class="card"><p class="sub">Nothing has been archived. Archiving puts things away without deleting them — you can bring anything back from here.</p></section>` : ""}`;
}

/**
 * Everyone at once: one block per person, each still its own invoice, which is
 * what prints as one page each. Anyone owed nothing is left out - a page
 * reading zero is noise on an invoice run.
 */
function everyoneView(as: "guardian" | "payer", clients: Client[], shifts: Shift[], expenses: Expense[], trips: Trip[], adjustments: Adjustment[]) {
  const all = clients.map((c) => ({
    client: c,
    inv: buildInvoice(`payer-${c.id}`, c.id, c.name, shifts.filter((s) => s.endAt), expenses, trips, adjustments),
  }));
  const billable = all.filter((r) => r.inv.total !== 0);

  const block = ({ client, inv }: (typeof all)[number]) => {
    const rate = client.defaultRate ?? 0;
    const outlay = inv.expenses + inv.mileage;
    if (!inv.total) {
      return `<h3 style="margin-top:16px">${client.name}</h3><p class="empty">Nothing owed.</p>`;
    }
    return `<h3 style="margin-top:16px">${client.name} — ${money(inv.total)}</h3>
      <table>
        <tr><th>When</th><th>What</th><th class="n">Amount</th></tr>
        ${inv.lines.map((l) => `<tr><td>${day(l.when)}</td>
          <td>${l.detail}${l.quantity ? `<br><span class="sub">${l.quantity}</span>` : ""}</td>
          <td class="n">${money(l.amount)}</td></tr>`).join("")}
        <tr><td></td><td class="sub">Time</td><td class="n sub">${money(inv.time)}</td></tr>
        <tr><td></td><td class="sub">Expenses</td><td class="n sub">${money(inv.expenses)}</td></tr>
        <tr><td></td><td class="sub">Mileage</td><td class="n sub">${money(inv.mileage)}</td></tr>
        ${inv.adjustments ? `<tr><td></td><td class="sub">Adjustments</td><td class="n sub">${money(inv.adjustments)}</td></tr>` : ""}
        <tr><td></td><td><b>Total</b></td><td class="n"><b>${money(inv.total)}</b></td></tr>
      </table>
      ${as === "payer" && outlay ? `<p class="sub">Expenses and mileage: ${money(outlay)}${rate > 0
        ? ` — or +${dur(expenseAsMinutes(outlay, rate))} at ${money(rate)}/hr.`
        : " — no hourly rate set, so there is no time equivalent."}</p>` : ""}`;
  };

  return `<section class="card">
    <h2>Everyone</h2>
    <p class="sub">Every person and what makes up their claim. ${billable.length
      ? `${billable.length} to invoice, one page each when printed — anyone owed nothing is left out of the printing.`
      : "Nobody is owed anything yet."}</p>
    ${all.map(block).join("")}
    ${billable.length ? `<div class="acts" style="margin-top:16px">
      <button class="tiny" data-print="all">Print all — one page each</button>
      <button class="tiny ghost" data-print="alldraft">Draft of all, with notes</button>
    </div>
    <div class="grid" style="margin-top:12px">
      <div class="stat"><b>${money(billable.reduce((t, r) => t + r.inv.total, 0))}</b><span>owed altogether</span></div>
      <div class="stat"><b>${billable.length}</b><span>invoices</span></div>
    </div>` : ""}
  </section>`;
}

function shareView(as: "guardian" | "payer", clientId: string, shifts: Shift[], expenses: Expense[], clients: Client[], name: (id: string) => string, trips: Trip[], notes: Note[], store: ReturnType<typeof replay>, adjustments: Adjustment[]) {
  const who = clients.find((c) => c.id === clientId);
  if (!who) return `<section class="card"><p class="empty">Add someone first.</p></section>`;

  // Run the real audience filter rather than a hand-rolled one: this is the
  // code that is tested against constructed leak attempts, and it is what
  // decides what another family is allowed to see.
  const ctx: AudienceContext = { audience: as, partyId: `payer-${clientId}` };
  const visible = clientsVisibleTo(store, ctx);
  const theirShifts = shifts
    .filter((s) => s.endAt && s.participants.some((p) => p.clientId === clientId))
    .map((s) => filterShiftFor(s, ctx, visible))
    .filter((s): s is Shift => s !== null) as Shift[];
  const rows = theirShifts.map((s) => {
    const p = s.participants.find((x) => x.clientId === clientId)!;
    const worked = mins(p.inAt, p.outAt);
    const share = expenses
      .map((e) => filterExpenseFor(e, ctx, visible))
      .filter((e): e is Expense => e !== null)
      .filter((e) => e.shiftId === s.id)
      .flatMap((e) => e.splits.filter((sp) => sp.clientId === clientId))
      .reduce((t, sp) => t + sp.amount, 0);
    const extra = expenseAsMinutes(share, p.payRate);
    return { s, p, worked, share, extra };
  });

  const loose = expenses.filter((e) => !e.shiftId).flatMap((e) => e.splits.filter((sp) => sp.clientId === clientId));
  const looseTotal = loose.reduce((t, sp) => t + sp.amount, 0);
  // Mileage was missing from both shared views, so a payer saw a claim smaller
  // than the one they will actually be sent.
  const theirTrips = trips.filter((t) => t.splits.some((sp) => sp.clientId === clientId));
  const mileageTotal = theirTrips.flatMap((t) => t.splits.filter((sp) => sp.clientId === clientId)).reduce((a, sp) => a + sp.claimAmount, 0);
  const rate = who.defaultRate ?? 0;

  // Built from the unfiltered records on purpose. The audience filter strips
  // reimbursementStatus, which would make every shift look unbillable and
  // silently drop all the time from the invoice. buildInvoice is already
  // scoped to this payer, so it cannot reach another family's money anyway -
  // the filtered set above is what governs what is DISPLAYED as theirs.
  const billable = shifts.filter((s) => s.endAt && s.participants.some((p) => p.payerPartyId === `payer-${clientId}`));
  const invoice = buildInvoice(`payer-${clientId}`, clientId, who.name, billable, expenses, trips, adjustments);
  const totalWorked = rows.reduce((t, r) => t + r.worked, 0);
  const outlay = invoice.expenses + invoice.mileage;
  const outlayAsTime = expenseAsMinutes(outlay, rate);

  const sharedNotes = (() => {
    const ids = new Set(theirShifts.map((x) => x.id));
    return notes.filter((n) => ids.has(n.attachedToId) && n.visibility[as]);
  })();

  const lineRows = invoice.lines.map((l) => `<tr>
      <td>${day(l.when)}</td>
      <td>${l.detail}${l.quantity ? `<br><span class="sub">${l.quantity}</span>` : ""}</td>
      <td class="n">${money(l.amount)}</td>
    </tr>`).join("");

  return `<section class="card">
    <h2>${as === "guardian" ? "Guardian view" : "Payer view"} — ${who.name}</h2>
    <p class="sub">${as === "guardian"
      ? "Only this person is shown. Every line says what it is made of, so the cost can be checked rather than taken on trust."
      : "The same claim two ways: what it costs, or the time it is worth at this person's agreed rate. The rate is unchanged."}</p>

    ${invoice.lines.length ? `<table>
      <tr><th>When</th><th>What</th><th class="n">Amount</th></tr>
      ${lineRows}
      <tr><td></td><td><b>Time</b></td><td class="n"><b>${money(invoice.time)}</b></td></tr>
      <tr><td></td><td><b>Expenses</b></td><td class="n"><b>${money(invoice.expenses)}</b></td></tr>
      <tr><td></td><td><b>Mileage</b></td><td class="n"><b>${money(invoice.mileage)}</b></td></tr>
      ${invoice.adjustments ? `<tr><td></td><td><b>Adjustments</b></td><td class="n"><b>${money(invoice.adjustments)}</b></td></tr>` : ""}
      <tr><td></td><td><b>Total</b></td><td class="n"><b>${money(invoice.total)}</b></td></tr>
    </table>` : `<p class="empty">Nothing recorded for ${who.name} yet.</p>`}

    ${sharedNotes.length ? `<h3 style="margin-top:14px">Notes</h3>
      <table><tbody>${sharedNotes.map((n) => `<tr><td>${n.body}<br><span class="sub">${day(n.occurredAt)}</span></td></tr>`).join("")}</tbody></table>` : ""}

    ${as === "payer" ? `<div class="acts" style="margin-top:14px">
      <button class="tiny" data-print="one">Invoice for ${who.name}</button>
      <button class="tiny ghost" data-print="draft">Draft with notes</button>
    </div>

    <h3 style="margin-top:16px">Adjustments</h3>
    <p class="sub">A late change to what is invoiced. The shift or receipt itself is untouched — it stays a record of what happened. A final invoice folds these into the total; a draft shows them.</p>
    ${adjustments.filter((a) => a.payerPartyId === `payer-${clientId}`).length
      ? `<table><tbody>${adjustments.filter((a) => a.payerPartyId === `payer-${clientId}`).map((a) => `<tr>
          <td>${a.note || "Adjustment"}<br><span class="sub">${day(a.occurredAt)}</span></td>
          <td class="n">${money(a.amountDelta)}</td>
          <td class="n">${trash("adjustment", a.id, `${a.note} (${money(a.amountDelta)})`, "adjustment")}</td></tr>`).join("")}</tbody></table>`
      : `<p class="empty">None.</p>`}
    <div class="row">
      <input id="adjNote" placeholder="Reason, e.g. agreed discount" />
      <input id="adjAmt" type="number" step="0.01" placeholder="-5.00" style="max-width:120px" title="Negative reduces the invoice" />
      <button class="tiny" data-add-adj="${clientId}">Add</button>
    </div>

    ${invoice.total ? `<div class="acts" style="margin-top:14px">
      <button class="tiny pink" data-mark-paid="payer-${clientId}">Mark all as paid</button>
    </div>` : ""}` : ""}

    <div class="grid" style="margin-top:12px">
      ${as === "payer"
        ? `<div class="stat"><b>${dur(totalWorked)}</b><span>time with ${who.name}</span></div>
           <div class="stat two-ways"><b>${money(outlay)}</b><span>expenses and mileage</span>
             ${rate > 0
               ? `<em>or</em><b>+${dur(outlayAsTime)}</b><span>at ${money(rate)}/hr</span>`
               : `<span class="sub" style="margin-top:4px">no hourly rate set, so no time equivalent</span>`}</div>
           <div class="stat"><b>${money(invoice.total)}</b><span>total owed</span></div>`
        : `<div class="stat"><b>${dur(totalWorked)}</b><span>time</span></div>
           <div class="stat"><b>${money(invoice.time)}</b><span>support</span></div>
           <div class="stat"><b>${money(invoice.expenses)}</b><span>expenses</span></div>
           <div class="stat"><b>${money(invoice.mileage)}</b><span>mileage</span></div>
           <div class="stat"><b>${money(invoice.total)}</b><span>total owed</span></div>`}
    </div>
  </section>`;
}

function confirmModal() {
  const c = ui.confirm;
  if (!c) return "";
  if (c.what === "payment") {
    return `<div class="overlay" data-close-modal="1"><div class="modal">
      <h3>Mark this as paid?</h3>
      <div class="target">${c.label}</div>
      <p>Every unclaimed and submitted shift, expense and trip for them moves to paid and leaves the working lists.</p>
      <p>Nothing is deleted. You can reopen any of it from the Archived view.</p>
      <div class="acts">
        <button class="ghost" data-close-modal="1">Cancel</button>
        <button class="confirm" id="doPaid">Mark paid</button>
      </div>
    </div></div>`;
  }
  const note = c.what === "shift"
    ? "Its expenses stay, but they will no longer be attached to a shift."
    : c.what === "person"
      ? "Shifts already logged for them are kept."
      : "";
  return `<div class="overlay" data-close-modal="1"><div class="modal">
    <h3>Delete this ${c.what}?</h3>
    <div class="target">${c.label}</div>
    <p>${note}</p>
    <p>It stops showing in the app. Nothing is erased from the log, so a restore still brings it back.</p>
    <div class="acts">
      <button class="ghost" data-close-modal="1">Cancel</button>
      <button class="confirm" id="doDelete">Delete</button>
    </div>
  </div></div>`;
}

function shiftDetail(s: Shift, expenses: Expense[], done: Shift[], name: (id: string) => string, clients: Client[], notes: Note[]) {
  const attached = expenses.filter((e) => e.shiftId === s.id);
  const shiftNotes = notes.filter((n) => n.attachedToId === s.id);
  const others = done.filter((d) => d.id !== s.id);
  return `<div class="detail">
    <h3>Shift detail</h3>
    <div class="row"><label style="flex:0 0 auto">Start</label><input id="sst" type="datetime-local" value="${forInput(s.startAt)}" />
      <label style="flex:0 0 auto">End</label><input id="sen" type="datetime-local" value="${forInput(s.endAt!)}" />
      <button class="tiny" data-save-shift="${s.id}">Save</button></div>
    <h3 style="margin-top:12px">Who was there</h3>
    <table><tbody>${s.participants.map((p, i) => `<tr>
      <td>${name(p.clientId)}</td>
      <td><input type="datetime-local" data-pin="${i}" value="${forInput(p.inAt)}" style="max-width:195px" /></td>
      <td><input type="datetime-local" data-pout="${i}" value="${forInput(p.outAt)}" style="max-width:195px" /></td>
      <td class="n"><input type="number" step="0.5" data-prate="${i}" value="${(p.payRate / 100).toFixed(2)}" style="max-width:85px" title="$/hr" /></td>
      <td class="n">${ruleSelect(`prule-${i}`, p.timeRule)}</td>
      <td class="n"><button class="tiny ghost" data-drop="${i}">Remove</button></td></tr>`).join("")}</tbody></table>
    ${clients.filter((c) => !s.participants.some((p) => p.clientId === c.id)).length ? `<div class="row">
      <select id="addWho">${clients.filter((c) => !s.participants.some((p) => p.clientId === c.id)).map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}</select>
      <input id="addIn" type="datetime-local" value="${forInput(s.startAt)}" title="Arrived" />
      <input id="addOut" type="datetime-local" value="${forInput(s.endAt ?? s.startAt)}" title="Left" />
      <button class="tiny pink" data-add-person="${s.id}">Add person</button>
    </div>` : ""}
    <button class="tiny" data-save-people="${s.id}" style="margin-top:8px">Save who was there</button>

    <h3 style="margin-top:14px">Notes</h3>
    ${shiftNotes.length ? `<table><tbody>${shiftNotes.map((n) => `<tr>
      <td>${n.body}<br><span class="sub">${n.visibility.payer || n.visibility.guardian
        ? `shared with ${[n.visibility.payer ? "payer" : "", n.visibility.guardian ? "guardian" : ""].filter(Boolean).join(" and ")}`
        : "private to you"}</span></td>
      <td class="n">${trash("note", n.id, n.body.slice(0, 40), "note")}</td></tr>`).join("")}</tbody></table>`
      : `<p class="empty">No notes on this shift.</p>`}
    <div class="row"><input id="noteBody" placeholder="What happened?" /><button class="tiny" data-add-note="${s.id}">Add note</button></div>
    <p class="sub"><label style="display:inline;margin-right:12px"><input type="checkbox" id="notePayer" style="width:auto" /> visible to payer</label>
      <label style="display:inline"><input type="checkbox" id="noteGuardian" style="width:auto" /> visible to guardian</label>
      — private to you unless ticked.</p>

    <p class="sub" style="margin-top:12px"><label style="display:inline"><input type="checkbox" id="isIncident" ${s.isIncident ? "checked" : ""} data-incident="${s.id}" style="width:auto" /> <b>Mark this shift as an incident</b></label></p>
    <p style="margin:6px 0">${attached.length ? attached.map((e) => `<span class="pill warn">${e.description} ${money(e.totalAmount)}</span>`).join("") : `<span class="empty">No expenses attached</span>`}</p>
    <div class="acts">
      <button class="tiny ghost" data-split="${s.id}">Split in half</button>
      <button class="tiny ghost" data-arch-shift="${s.id}">Archive</button>
      ${others.length ? `<select id="mergeWith" style="width:auto">${others.map((o) => `<option value="${o.id}">${day(o.startAt)} ${hhmm(o.startAt)}</option>`).join("")}</select>
        <button class="tiny pink" data-merge="${s.id}">Merge with</button>` : ""}
      ${trash("shift", s.id, `${day(s.startAt)} ${hhmm(s.startAt)}–${hhmm(s.endAt!)}`, "shift")}
      <button class="tiny ghost" data-cancel="1">Close</button>
    </div>
  </div>`;
}

function wire(open: Shift | undefined, clients: Client[], done: Shift[], expenses: Expense[], allShifts: Shift[], name: (id: string) => string, allExpenses: Expense[], allTrips: Trip[], adjustments: Adjustment[], everyoneList: Client[]) {
  const $ = (id: string) => document.getElementById(id) as HTMLInputElement | null;
  const go = async (fn: () => Promise<void>) => { try { await fn(); } catch (err: any) { ui.msg = err.message; } render(); };
  const all = (sel: string, fn: (el: HTMLElement) => void) => document.querySelectorAll<HTMLElement>(sel).forEach(fn);

  all("[data-sort]", (el) => el.onclick = () => {
    const [list, key] = el.dataset.sort!.split(":") as [keyof typeof ui.sort, string];
    const s = ui.sort[list];
    s.dir = s.key === key ? -s.dir : -1;
    s.key = key;
    render();
  });

  all("[data-shift]", (el) => el.onclick = () => {
    ui.openShift = ui.openShift === el.dataset.shift ? null : el.dataset.shift!;
    ui.msg = "";
    render();
  });

  const readParticipants = (s: Shift) => s.participants.map((p, i) => {
    const inAt = fromInput((document.querySelector(`[data-pin="${i}"]`) as HTMLInputElement).value);
    const outAt = fromInput((document.querySelector(`[data-pout="${i}"]`) as HTMLInputElement).value);
    const payRate = Math.round(parseFloat((document.querySelector(`[data-prate="${i}"]`) as HTMLInputElement).value || "0") * 100);
    const timeRule = (document.getElementById(`prule-${i}`) as HTMLSelectElement).value as "fullPerPayer" | "splitEvenly";
    if (Date.parse(outAt) < Date.parse(inAt)) throw new Error(`${name(p.clientId)} cannot leave before they arrived.`);
    if (payRate < 0) throw new Error("A rate cannot be negative.");
    return { ...p, inAt, outAt, payRate, timeRule };
  });

  all("[data-save-people]", (el) => el.onclick = () => go(async () => {
    const s = allShifts.find((d) => d.id === el.dataset.savePeople)!;
    const participants = readParticipants(s);
    // Widen the shift to hold everyone, rather than silently clipping someone
    // who arrived before it or left after it.
    const startAt = participants.reduce((a, p) => (Date.parse(p.inAt) < Date.parse(a) ? p.inAt : a), s.startAt);
    const endAt = participants.reduce((a, p) => (Date.parse(p.outAt) > Date.parse(a) ? p.outAt : a), s.endAt ?? s.startAt);
    await emit("shift", s.id, { participants, startAt, endAt });
    ui.msg = "Saved.";
  }));

  all("[data-drop]", (el) => el.onclick = () => go(async () => {
    const s = allShifts.find((d) => d.id === ui.openShift)!;
    const i = Number(el.dataset.drop);
    if (s.participants.length === 1) throw new Error("A shift needs at least one person. Delete the shift instead.");
    await emit("shift", s.id, { participants: s.participants.filter((_, j) => j !== i) });
    ui.msg = `${name(s.participants[i].clientId)} removed from this shift.`;
  }));

  all("[data-add-note]", (el) => el.onclick = () => go(async () => {
    const body = $("noteBody")!.value.trim();
    if (!body) throw new Error("Write the note first.");
    await emit("note", newId(), {
      body, attachedToType: "shift", attachedToId: el.dataset.addNote!,
      occurredAt: nowInstant(), recordedAt: nowInstant(),
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      // Private unless explicitly shared: a note written for yourself should
      // never reach a family because sharing was the default.
      visibility: { me: true, payer: ($("notePayer") as HTMLInputElement).checked, guardian: ($("noteGuardian") as HTMLInputElement).checked },
      tags: [], customFields: {},
    });
  }));

  all("[data-incident]", (el) => (el as HTMLInputElement).onchange = () => go(() =>
    emit("shift", el.dataset.incident!, { isIncident: (el as HTMLInputElement).checked })));

  all("[data-add-person]", (el) => el.onclick = () => go(async () => {
    const s = allShifts.find((d) => d.id === el.dataset.addPerson)!;
    const clientId = ($("addWho") as unknown as HTMLSelectElement).value;
    const inAt = fromInput($("addIn")!.value);
    const outAt = fromInput($("addOut")!.value);
    if (Date.parse(outAt) < Date.parse(inAt)) throw new Error("They cannot leave before they arrived.");
    const c = clients.find((x) => x.id === clientId);
    await emit("shift", s.id, {
      participants: [...s.participants, {
        clientId, payerPartyId: `payer-${clientId}`, inAt, outAt,
        payRate: c?.defaultRate ?? 0, timeRule: c?.defaultTimeRule ?? "fullPerPayer",
      }],
      startAt: Date.parse(inAt) < Date.parse(s.startAt) ? inAt : s.startAt,
      endAt: Date.parse(outAt) > Date.parse(s.endAt ?? s.startAt) ? outAt : s.endAt,
    });
    ui.msg = `${c?.name ?? "They"} added, ${hhmm(inAt)}–${hhmm(outAt)}.`;
  }));

  if ($("logPast")) $("logPast")!.onclick = () => go(async () => {
    const clientId = ($("pastWho") as unknown as HTMLSelectElement).value;
    const startAt = fromInput($("pastFrom")!.value);
    const endAt = fromInput($("pastTo")!.value);
    if (!$("pastFrom")!.value || !$("pastTo")!.value) throw new Error("Set when the shift started and ended.");
    if (Date.parse(endAt) <= Date.parse(startAt)) throw new Error("The end must come after the start.");
    const c = clients.find((x) => x.id === clientId);
    await emit("shift", newId(), {
      startAt, endAt,
      // occurredAt is when the work happened; recordedAt is now. Keeping them
      // apart is what makes a shift entered days later still sort correctly.
      occurredAt: startAt, recordedAt: nowInstant(),
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      participants: [{ clientId, payerPartyId: `payer-${clientId}`, inAt: startAt, outAt: endAt,
        payRate: c?.defaultRate ?? 0, timeRule: c?.defaultTimeRule ?? "fullPerPayer" }],
      isIncident: false, reimbursementStatus: "unclaimed", tags: [], customFields: {},
    });
    ui.msg = "Past shift logged. Open it to add anyone else who was there.";
  });

  all("[data-arch-shift]", (el) => el.onclick = (e) => {
    e.stopPropagation();
    go(async () => { ui.openShift = null; await emit("shift", el.dataset.archShift!, { archived: true }); });
  });
  all("[data-paid]", (el) => el.onclick = (e) => {
    e.stopPropagation();
    go(() => emit("expense", el.dataset.paid!, { reimbursementStatus: "paid" }));
  });
  all("[data-unarch-shift]", (el) => el.onclick = () => go(() => emit("shift", el.dataset.unarchShift!, { archived: false })));
  all("[data-untrip]", (el) => el.onclick = () => go(() => emit("trip", el.dataset.untrip!, { reimbursementStatus: "unclaimed", archived: false })));
  all("[data-unpaid]", (el) => el.onclick = () => go(() => emit("expense", el.dataset.unpaid!, { reimbursementStatus: "unclaimed", archived: false })));

  all("[data-archive]", (el) => el.onclick = (e) => {
    e.stopPropagation();
    go(() => emit("client", el.dataset.archive!, { archived: true }));
  });
  all("[data-restore]", (el) => el.onclick = (e) => {
    e.stopPropagation();
    go(() => emit("client", el.dataset.restore!, { archived: false }));
  });

  all("[data-edit]", (el) => el.onclick = (e) => {
    e.stopPropagation();
    ui.editing = el.dataset.edit!;
    // Seed the split editor from what the expense already has, so opening it
    // and saving without touching anything changes nothing.
    const ex = allExpenses.find((x) => x.id === ui.editing);
    ui.editSplit = {};
    if (ex && ex.totalAmount) {
      for (const sp of ex.splits) ui.editSplit[sp.clientId] = (sp.amount / ex.totalAmount) * 100;
    }
    render();
  });

  all("[data-shot]", (el) => (el as HTMLInputElement).onchange = (ev: any) => go(async () => {
    const file = ev.target.files?.[0];
    if (!file) return;
    const expenseId = el.dataset.shot!;
    const { dataUrl, bytes } = await shrinkImage(file);
    const attachmentId = newId();
    await emit("attachment", attachmentId, {
      mimeType: "image/jpeg", dataUrl, bytes,
      attachedToType: "expense", attachedToId: expenseId,
      occurredAt: nowInstant(), recordedAt: nowInstant(),
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone, tags: [], customFields: {},
    });
    const ex = allExpenses.find((x) => x.id === expenseId)!;
    await emit("expense", expenseId, { receiptAttachmentIds: [...ex.receiptAttachmentIds, attachmentId] });
    ui.msg = `Receipt attached (${readableSize(bytes)}).`;
  }));

  all("[data-unshot]", (el) => el.onclick = () => go(async () => {
    const [expenseId, attachmentId] = el.dataset.unshot!.split(":");
    const ex = allExpenses.find((x) => x.id === expenseId)!;
    await emit("expense", expenseId, { receiptAttachmentIds: ex.receiptAttachmentIds.filter((i) => i !== attachmentId) });
    await emit("attachment", attachmentId, { deleted: true });
  }));

  all("[data-efor]", (el) => (el as HTMLInputElement).onchange = () => {
    const id = el.dataset.efor!;
    if (ui.editSplit[id] === undefined) ui.editSplit[id] = 0; else delete ui.editSplit[id];
    const ids = Object.keys(ui.editSplit);
    ids.forEach((x) => (ui.editSplit[x] = 100 / ids.length));
    render();
  });
  all("[data-epct]", (el) => (el as HTMLInputElement).oninput = () => {
    ui.editSplit[el.dataset.epct!] = parseFloat((el as HTMLInputElement).value || "0");
  });
  all("[data-cancel]", (el) => el.onclick = (e) => { e.stopPropagation(); ui.editing = null; ui.openShift = null; ui.msg = ""; render(); });

  all("[data-ask]", (el) => el.onclick = (e) => {
    e.stopPropagation();
    const [kind, id, label, what] = el.dataset.ask!.split("|");
    ui.confirm = { kind, id, label: decodeURIComponent(label), what: decodeURIComponent(what) };
    render();
  });

  all("[data-close-modal]", (el) => el.onclick = (e) => {
    if (e.target !== el) return; // clicks inside the dialog must not dismiss it
    ui.confirm = null;
    render();
  });

  if ($("doPaid")) $("doPaid")!.onclick = () => go(async () => {
    const payer = ui.confirm!.id;
    ui.confirm = null;
    for (const from of ["unclaimed", "submitted"] as const) {
      await restamp(payer, from as any, "paid");
    }
    ui.msg = "Marked paid. It is in the Archived view if you need it back.";
  });

  if ($("doDelete")) $("doDelete")!.onclick = () => go(async () => {
    const c = ui.confirm!;
    ui.confirm = null;
    if (c.kind === "shift") ui.openShift = null;
    await remove(c.kind as Parameters<typeof makeEvent>[0], c.id);
  });

  all("[data-save-client]", (el) => el.onclick = () => go(async () => {
    const v = $("ren")!.value.trim();
    if (!v) return;
    const rate = Math.round(parseFloat($("rrate")!.value || "0") * 100);
    if (rate < 0) throw new Error("A rate cannot be negative.");
    const rule = ($("rrule") as unknown as HTMLSelectElement).value;
    await emit("client", el.dataset.saveClient!, { name: v, defaultRate: rate, defaultTimeRule: rule });
    ui.editing = null;
  }));

  all("[data-save-exp]", (el) => el.onclick = () => go(async () => {
    const cents = Math.round(parseFloat($("ea")!.value || "0") * 100);
    const ids = Object.keys(ui.editSplit);
    if (!ids.length) throw new Error("An expense has to be for someone.");
    const parts = splitByPercent(cents, ids.map((id) => ui.editSplit[id]));
    await emit("expense", el.dataset.saveExp!, {
      description: $("ed")!.value || "Expense",
      totalAmount: cents,
      splits: ids.map((id, i) => ({ clientId: id, payerPartyId: `payer-${id}`, amount: parts[i] })),
    });
    ui.editing = null;
    ui.editSplit = {};
  }));

  all("[data-save-shift]", (el) => el.onclick = () => go(async () => {
    const s = done.find((d) => d.id === el.dataset.saveShift)!;
    const startAt = fromInput($("sst")!.value);
    const endAt = fromInput($("sen")!.value);
    if (Date.parse(endAt) <= Date.parse(startAt)) throw new Error("The end must come after the start.");
    // Clamp each person into the new window rather than stamping the window
    // onto everyone: overwriting their own times would erase who was actually
    // there when, and bill the wrong people for the wrong hours.
    await emit("shift", s.id, {
      startAt, endAt,
      participants: s.participants.map((p) => ({
        ...p,
        inAt: Date.parse(p.inAt) < Date.parse(startAt) ? startAt : p.inAt,
        outAt: Date.parse(p.outAt) > Date.parse(endAt) ? endAt : p.outAt,
      })),
    });
    ui.msg = "Shift times updated. Everyone kept their own arrival and leaving times.";
  }));

  all("[data-split]", (el) => el.onclick = () => go(async () => {
    const s = done.find((d) => d.id === el.dataset.split)!;
    const att = expenses.filter((e) => e.shiftId === s.id);
    const mid = new Date((Date.parse(s.startAt) + Date.parse(s.endAt!)) / 2).toISOString();
    await emitAll(splitShiftAt(s, mid, dev, await nextSeq(db, dev, 3 + att.length), att));
    ui.openShift = null;
    ui.msg = "Split into two shifts.";
  }));

  all("[data-merge]", (el) => el.onclick = () => go(async () => {
    const a = done.find((d) => d.id === el.dataset.merge)!;
    const b = done.find((d) => d.id === ($("mergeWith") as unknown as HTMLSelectElement).value)!;
    const att = expenses.filter((e) => e.shiftId === a.id || e.shiftId === b.id);
    await emitAll(mergeShifts(a, b, dev, await nextSeq(db, dev, 3 + att.length), att));
    ui.openShift = null;
    ui.msg = "Merged.";
  }));

  if ($("viewAs")) ($("viewAs") as unknown as HTMLSelectElement).onchange = (e: any) => {
    ui.view.as = e.target.value;
    if (!ui.view.clientId) ui.view.clientId = clients[0]?.id ?? "";
    render();
  };
  if ($("viewWho")) ($("viewWho") as unknown as HTMLSelectElement).onchange = (e: any) => {
    ui.view.clientId = e.target.value;
    render();
  };

  // Picking a different person shows that person's standing rate.
  const syncRate = (selId: string, rateId: string) => {
    const sel = $(selId) as unknown as HTMLSelectElement | null;
    if (!sel) return;
    sel.onchange = () => {
      const c = clients.find((x) => x.id === sel.value);
      if (c) $(rateId)!.value = ((c.defaultRate ?? 0) / 100).toFixed(2);
    };
  };
  syncRate("who", "rate");
  syncRate("arrive", "arate");

  if ($("addc")) $("addc")!.onclick = () => go(async () => {
    const v = $("cname")!.value.trim();
    if (!v) return;
    const rate = Math.round(parseFloat($("crate")!.value || "0") * 100);
    // $0 is allowed and meaningful: the worker himself appears on the list and
    // is not paid for his own time. Only a negative rate is nonsense.
    if (rate < 0) throw new Error("A rate cannot be negative.");
    const clientId = newId();
    const partyId = `payer-${clientId}`;
    await emit("client", clientId, { name: v, defaultRate: rate, defaultTimeRule: "fullPerPayer", occurredAt: nowInstant(), recordedAt: nowInstant() });
    // The party and role records are what audience filtering reads. Without
    // them the confidentiality rules have nothing to work from, so a shared
    // view would have to be hand-rolled and could drift from the tested one.
    await emit("party", partyId, {
      kind: "org", name: `${v} (payer)`, defaultMileageRate: 68, mileagePolicy: "perTrip",
      occurredAt: nowInstant(), recordedAt: nowInstant(), zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      tags: [], customFields: {},
    });
    await emit("role", newId(), {
      clientId, partyId, role: "payer",
      occurredAt: nowInstant(), recordedAt: nowInstant(), zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      tags: [], customFields: {},
    });
    await emit("role", newId(), {
      clientId, partyId, role: "guardian",
      occurredAt: nowInstant(), recordedAt: nowInstant(), zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      tags: [], customFields: {},
    });
  });

  if ($("start")) $("start")!.onclick = () => go(async () => {
    const clientId = ($("who") as unknown as HTMLSelectElement).value;
    const payRate = Math.round(parseFloat($("rate")!.value) * 100);
    const now = nowInstant();
    await emit("shift", newId(), {
      startAt: now, endAt: null, occurredAt: now, recordedAt: now,
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      participants: [{ clientId, payerPartyId: `payer-${clientId}`, inAt: now, outAt: now, payRate,
        timeRule: clients.find((c) => c.id === clientId)?.defaultTimeRule ?? "fullPerPayer" }],
      isIncident: false, reimbursementStatus: "unclaimed", tags: [], customFields: {},
    });
  });

  if ($("end")) $("end")!.onclick = () => go(async () => {
    const now = nowInstant();
    // Anyone already marked as left keeps the time they actually left at; only
    // those still present are closed out now. Each person's own billing rule is
    // left untouched - one global rule would silently rewrite the others.
    await emit("shift", open!.id, {
      endAt: now,
      participants: open!.participants.map((p) =>
        Date.parse(p.outAt) > Date.parse(p.inAt) ? p : { ...p, outAt: now }),
    });
  });

  all("[data-rule]", (el) => (el as HTMLSelectElement).onchange = () => go(async () => {
    const i = Number(el.dataset.rule!.split("-")[1]);
    const value = (el as HTMLSelectElement).value as "fullPerPayer" | "splitEvenly";
    await emit("shift", open!.id, {
      participants: open!.participants.map((p, j) => (j === i ? { ...p, timeRule: value } : p)),
    });
  }));

  all("[data-left]", (el) => el.onclick = () => go(async () => {
    const i = Number(el.dataset.left);
    const now = nowInstant();
    await emit("shift", open!.id, {
      participants: open!.participants.map((p, j) => (j === i ? { ...p, outAt: now } : p)),
    });
  }));

  if ($("addp")) $("addp")!.onclick = () => go(async () => {
    const clientId = ($("arrive") as unknown as HTMLSelectElement).value;
    const payRate = Math.round(parseFloat($("arate")!.value || "0") * 100);
    const now = nowInstant();
    // One shift, several people, different arrival times - exactly what the
    // allocation engine is built to bill correctly.
    await emit("shift", open!.id, {
      participants: [...open!.participants, { clientId, payerPartyId: `payer-${clientId}`, inAt: now, outAt: now, payRate,
        timeRule: clients.find((c) => c.id === clientId)?.defaultTimeRule ?? "fullPerPayer" }],
    });
    ui.msg = `${clients.find((c) => c.id === clientId)?.name ?? "They"} added to this shift.`;
  });

  if ($("adde")) $("adde")!.onclick = () => go(async () => {
    const cents = Math.round(parseFloat($("eamt")!.value || "0") * 100);
    if (!cents) throw new Error("Enter an amount.");
    const ids = Object.keys(ui.expFor);
    if (!ids.length) throw new Error("Choose who the expense was for.");
    // splitByPercent refuses shares that do not total 100 and accounts for
    // every leftover cent, so the parts always sum back to the receipt.
    const parts = splitByPercent(cents, ids.map((id) => ui.expFor[id]));
    await emit("expense", newId(), {
      description: $("edesc")!.value || "Expense", totalAmount: cents, category: "other",
      occurredAt: nowInstant(), recordedAt: nowInstant(), shiftId: open?.id ?? null,
      receiptAttachmentIds: [], reimbursementStatus: "unclaimed",
      splits: ids.map((id, i) => ({ clientId: id, payerPartyId: `payer-${id}`, amount: parts[i] })),
    });
    ui.expFor = {};
    ui.draft = { desc: "", amt: "" };
  });

  // Ticking someone in or out re-splits the remaining shares evenly.
  const evenly = () => {
    const ids = Object.keys(ui.expFor);
    if (!ids.length) return;
    const each = 100 / ids.length;
    ids.forEach((id) => (ui.expFor[id] = each));
  };

  all("[data-for]", (el) => (el as HTMLInputElement).onchange = () => {
    const id = el.dataset.for!;
    if (ui.expFor[id] === undefined) ui.expFor[id] = 0;
    else delete ui.expFor[id];
    evenly();
    render();
  });

  all("[data-pct]", (el) => (el as HTMLInputElement).oninput = () => {
    ui.expFor[el.dataset.pct!] = parseFloat((el as HTMLInputElement).value || "0");
    preview();
  });

  // Live preview of what each person's share comes to.
  function preview() {
    const cents = Math.round(parseFloat($("eamt")?.value || "0") * 100);
    const ids = Object.keys(ui.expFor);
    const total = ids.reduce((t, id) => t + ui.expFor[id], 0);
    const el = document.getElementById("pcttotal");
    if (el) {
      const off = Math.abs(total - 100) > 0.05;
      el.textContent = ids.length ? `${total.toFixed(1)}% allocated${off ? " — must be 100%" : ""}` : "";
      el.style.color = off ? "var(--danger)" : "var(--muted)";
    }
    ids.forEach((id, i) => {
      const out = document.getElementById(`pv-${id}`);
      if (!out) return;
      try {
        out.textContent = cents ? money(splitByPercent(cents, ids.map((x) => ui.expFor[x]))[i]) : "";
      } catch {
        out.textContent = "";
      }
    });
  }
  if ($("eamt")) $("eamt")!.oninput = () => { ui.draft.amt = $("eamt")!.value; preview(); };
  if ($("edesc")) $("edesc")!.oninput = () => { ui.draft.desc = $("edesc")!.value; };
  preview();

  const tripPreview = () => {
    const km = parseFloat($("tkm")?.value || "0");
    const rate = Math.round(parseFloat($("trate")?.value || "0") * 100) / 100;
    const ids = Object.keys(ui.tripFor);
    const el = document.getElementById("tpcttotal");
    const total = ids.reduce((t, id) => t + ui.tripFor[id], 0);
    if (el) {
      const off = Math.abs(total - 100) > 0.05;
      el.textContent = ids.length ? `${total.toFixed(1)}% allocated${off ? " — must be 100%" : ""}` : "";
      el.style.color = off ? "var(--danger)" : "var(--muted)";
    }
    ids.forEach((id, i) => {
      const out = document.getElementById(`tv-${id}`);
      if (!out) return;
      try {
        out.textContent = km && rate ? money(tripShares(km, Math.round(rate), ids.map((x) => ui.tripFor[x])).shares[i].claim) : "";
      } catch { out.textContent = ""; }
    });
  };

  all("[data-tfor]", (el) => (el as HTMLInputElement).onchange = () => {
    const id = el.dataset.tfor!;
    if (ui.tripFor[id] === undefined) ui.tripFor[id] = 0; else delete ui.tripFor[id];
    const ids = Object.keys(ui.tripFor);
    ids.forEach((x) => (ui.tripFor[x] = 100 / ids.length));
    render();
  });
  all("[data-tpct]", (el) => (el as HTMLInputElement).oninput = () => {
    ui.tripFor[el.dataset.tpct!] = parseFloat((el as HTMLInputElement).value || "0");
    tripPreview();
  });
  ["tkm", "trate"].forEach((id) => { if ($(id)) $(id)!.oninput = () => { (ui.tripDraft as any)[id === "tkm" ? "km" : "rate"] = $(id)!.value; tripPreview(); }; });
  if ($("tpurpose")) $("tpurpose")!.oninput = () => { ui.tripDraft.purpose = $("tpurpose")!.value; };
  tripPreview();

  if ($("addTrip")) $("addTrip")!.onclick = () => go(async () => {
    const distance = parseFloat($("tkm")!.value || "0");
    const rate = Math.round(parseFloat($("trate")!.value || "0"));
    const ids = Object.keys(ui.tripFor);
    if (!distance) throw new Error("Enter the distance.");
    if (!rate) throw new Error("Enter the rate per km or mile, in cents.");
    if (!ids.length) throw new Error("Choose who was in the car.");
    const { shares } = tripShares(distance, rate, ids.map((id) => ui.tripFor[id]));
    await emit("trip", newId(), {
      distance, distanceUnit: ($("tunit") as unknown as HTMLSelectElement).value,
      purpose: $("tpurpose")!.value || "Trip", isClaimable: true,
      occurredAt: nowInstant(), recordedAt: nowInstant(),
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      shiftId: open?.id ?? null, reimbursementStatus: "unclaimed", tags: [], customFields: {},
      // distanceShare is this person's kilometres, not their percentage: the
      // payer recomputes distance x rate, and checkTrip enforces the same.
      splits: ids.map((id, i) => ({
        clientId: id, payerPartyId: `payer-${id}`,
        distanceShare: shares[i].distanceShare, rateApplied: rate, claimAmount: shares[i].claim,
      })),
    });
    ui.tripFor = {};
    ui.tripDraft = { km: "", purpose: "", rate: "" };
  });

  /** Moves every record for one payer from one status to the next, under one claim id. */
  const restamp = async (payerPartyId: string, from: "unclaimed" | "submitted", to: "submitted" | "paid") => {
    const submissionId = newId();
    const touch = async (type: "shift" | "expense" | "trip", records: { id: string; reimbursementStatus: string }[], belongs: (r: any) => boolean) => {
      for (const r of records) {
        if (r.reimbursementStatus !== from || !belongs(r)) continue;
        await emit(type, r.id, to === "submitted" ? { reimbursementStatus: to, submissionId } : { reimbursementStatus: to });
      }
    };
    await touch("shift", allShifts as any, (s: Shift) => s.participants.some((p) => p.payerPartyId === payerPartyId));
    await touch("expense", allExpenses as any, (e: Expense) => e.splits.some((sp) => sp.payerPartyId === payerPartyId));
    await touch("trip", allTrips as any, (t: Trip) => t.splits.some((sp) => sp.payerPartyId === payerPartyId));
  };

  all("[data-submit]", (el) => el.onclick = () => go(async () => {
    const payer = el.dataset.submit!;
    // Refuse to send a claim built on records that fail their own checks: the
    // payer would query it, and by then it has your name on it.
    const bad = [
      ...allShifts.filter((s) => s.reimbursementStatus === "unclaimed" && s.participants.some((p) => p.payerPartyId === payer)).flatMap(checkShift),
      ...allExpenses.filter((e) => e.reimbursementStatus === "unclaimed" && e.splits.some((sp) => sp.payerPartyId === payer)).flatMap(checkExpense),
      ...allTrips.filter((t) => t.reimbursementStatus === "unclaimed" && t.splits.some((sp) => sp.payerPartyId === payer)).flatMap(checkTrip),
    ];
    if (!isSubmittable(bad)) {
      throw new Error(`Not ready to send: ${bad.map((v) => v.message).join("; ")}`);
    }
    await restamp(payer, "unclaimed", "submitted");
    ui.msg = "Marked as sent. It stays visible under Submitted until it is paid.";
  }));
  all("[data-settle]", (el) => el.onclick = () => go(async () => {
    await restamp(el.dataset.settle!, "submitted", "paid");
    ui.msg = "Marked paid.";
  }));

  const invoiceFor = (cid: string) => {
    const c = everyoneList.find((x) => x.id === cid);
    return buildInvoice(`payer-${cid}`, cid, c?.name ?? "Unknown", allShifts, allExpenses, allTrips, adjustments);
  };

  all("[data-print]", (el) => el.onclick = () => go(async () => {
    const mode = el.dataset.print!;
    const who = ui.view.clientId || clients[0]?.id || "";
    if (mode === "all" || mode === "alldraft") {
      // Everyone who is actually owed something: a page reading zero helps
      // nobody and makes the file harder to read.
      const invoices = clients.map((c) => invoiceFor(c.id)).filter((i) => i.total !== 0);
      if (!invoices.length) throw new Error("Nothing to invoice yet.");
      printInvoices(invoices, mode === "alldraft");
    } else {
      const inv = invoiceFor(who);
      if (!inv.total && mode !== "draft") throw new Error("Nothing to invoice for this person yet.");
      printInvoices([inv], mode === "draft");
    }
  }));

  all("[data-add-adj]", (el) => el.onclick = () => go(async () => {
    const amount = Math.round(parseFloat($("adjAmt")!.value || "0") * 100);
    if (!amount) throw new Error("Enter an amount. Negative reduces the invoice.");
    await emit("adjustment", newId(), {
      payerPartyId: `payer-${el.dataset.addAdj!}`,
      amountDelta: amount,
      note: $("adjNote")!.value.trim() || "Adjustment",
      occurredAt: nowInstant(), recordedAt: nowInstant(),
      zone: Intl.DateTimeFormat().resolvedOptions().timeZone, tags: [], customFields: {},
    });
    ui.msg = "Adjustment added. The original records are unchanged.";
  }));

  all("[data-mark-paid]", (el) => el.onclick = (e) => {
    e.stopPropagation();
    const payer = el.dataset.markPaid!;
    const inv = invoiceFor(payer.replace(/^payer-/, ""));
    ui.confirm = {
      kind: "paid", id: payer,
      label: `${inv.clientName} — ${money(inv.total)}`,
      what: "payment",
    };
    render();
  });

  if ($("syncNow")) $("syncNow")!.onclick = () => runSync(true);
  if ($("connectDrive")) $("connectDrive")!.onclick = () => go(async () => {
    ui.sync.token = await connectDrive(true);
    ui.sync.needsConnect = false;
    stamp(CONNECT_KEY);
    ui.sync.note = "Connected.";
    await runSync(false);
  });

  if ($("exp")) $("exp")!.onclick = async () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([await exportEventLog(db)], { type: "application/json" }));
    a.download = `respite-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  if ($("expReadable")) $("expReadable")!.onclick = async () => {
    // The event log is the thing that can be restored; this is the plain list
    // of what it adds up to, for an accountant or a payer who wants to read it.
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([exportAll(await hydrate(db))], { type: "application/json" }));
    a.download = `respite-summary-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  if ($("imp")) $("imp")!.onchange = (e: any) => go(async () => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = await importEventLog(db, await f.text());
    ui.msg = `Added ${r.imported} missing, already had ${r.skipped}${r.conflicts.length ? `, ${r.conflicts.length} kept back as conflicts` : ""}. Nothing was removed.`;
  });
}

/**
 * People added before audience filtering existed have no role records, so the
 * rules would find nothing visible and their shared views would come up empty.
 * Give them the same records a new person gets. Idempotent: it only fills gaps.
 */
async function backfillRoles() {
  const store = await hydrate(db);
  const clients = live(store, "client") as unknown as Client[];
  const roles = live(store, "role") as unknown as { clientId: string }[];
  const have = new Set(roles.map((r) => r.clientId));
  for (const c of clients) {
    if (have.has(c.id)) continue;
    const partyId = `payer-${c.id}`;
    const meta = { occurredAt: nowInstant(), recordedAt: nowInstant(), zone: Intl.DateTimeFormat().resolvedOptions().timeZone, tags: [], customFields: {} };
    await emit("party", partyId, { kind: "org", name: `${c.name} (payer)`, defaultMileageRate: 68, mileagePolicy: "perTrip", ...meta });
    await emit("role", newId(), { clientId: c.id, partyId, role: "payer", ...meta });
    await emit("role", newId(), { clientId: c.id, partyId, role: "guardian", ...meta });
  }
}

db.open().then(async () => {
  await backfillRoles();
  await render();
  // On open, every few minutes while open, and whenever the connection returns.
  void runSync(false);
  setInterval(() => { void runSync(false); }, 5 * 60 * 1000);
  window.addEventListener("online", () => { void runSync(false); });
}).catch((err) => {
  app.innerHTML = `<div class="card"><h2>Could not open the local database</h2><pre>${err.message}</pre></div>`;
});
