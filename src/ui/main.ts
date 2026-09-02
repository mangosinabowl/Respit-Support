import "./style.css";
import { RespiteDb, appendEvent, hydrate, nextSeq, deviceId, exportEventLog, importEventLog } from "../store/db";
import { makeEvent, type DomainEvent } from "../domain/events";
import { live } from "../domain/replay";
import { owedByPayer } from "../domain/queries";
import { newId, nowInstant } from "../domain/primitives";
import { splitShiftAt, mergeShifts } from "../domain/operations";
import type { Shift, Expense, Client } from "../domain/entities";

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
  sort: { shifts: { key: "startAt", dir: -1 }, expenses: { key: "occurredAt", dir: -1 }, owed: { key: "unclaimed", dir: -1 } },
};

async function emit(type: Parameters<typeof makeEvent>[0], id: string, fields: Record<string, unknown>) {
  await appendEvent(db, makeEvent(type, id, fields, dev, await nextSeq(db, dev)));
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

const TRASH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>`;

/** A trash button that asks before it acts. */
const trash = (kind: string, id: string, label: string, what: string) =>
  `<button class="trash" title="Delete" data-ask="${kind}|${id}|${encodeURIComponent(label)}|${encodeURIComponent(what)}">${TRASH}</button>`;

const arrow = (s: { key: string; dir: number }, k: string) => s.key === k ? `<span class="ar">${s.dir > 0 ? "\u25B2" : "\u25BC"}</span>` : "";

async function render() {
  const store = await hydrate(db);
  const clients = live(store, "client") as unknown as Client[];
  const allShifts = live(store, "shift") as unknown as Shift[];
  const expenses = live(store, "expense") as unknown as Expense[];
  const open = allShifts.find((s) => !s.endAt);
  const done = allShifts.filter((s) => s.endAt);
  const owed = owedByPayer(store);
  const name = (id: string) => clients.find((c) => c.id === id)?.name ?? "\u2014";

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
                <input id="arate" type="number" value="${((clients.filter((c) => !open.participants.some((p) => p.clientId === c.id))[0].defaultRate ?? 3000) / 100).toFixed(2)}" step="0.5" style="max-width:110px" />
                <button class="pink" id="addp">Someone arrived</button></div>`
             : ""}
           <p class="sub">Each person settles their own way. Time is shared only between the people set to split — anyone on the full hour is not counted in that split.</p>
           <div class="acts"><button id="end" class="primary">End shift</button>
           ${trash("shift", open.id, `the shift running since ${hhmm(open.startAt)}`, "shift")}</div>`
        : clients.length
          ? `<label>Who are you with?</label>
             <select id="who">${clients.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}</select>
             <label>Rate $/hr (CAD)</label><input id="rate" type="number" value="${((clients[0].defaultRate ?? 3000) / 100).toFixed(2)}" step="0.5" />
             <p class="sub">Their standing rate. Edit it under People to change it for good.</p>
             <button id="start" class="primary">Start shift</button>`
          : `<p class="empty">Add someone you support first.</p>`}
    </section>

    <section class="card">
      <h2>People</h2>
      <table><tbody>
        ${clients.map((c) => ui.editing === c.id
          ? `<tr><td colspan="2"><div class="row"><input id="ren" value="${c.name}" />
               <input id="rrate" type="number" step="0.5" style="max-width:110px" value="${((c.defaultRate ?? 3000) / 100).toFixed(2)}" title="Hourly rate" />
               ${ruleSelect("rrule", c.defaultTimeRule ?? "fullPerPayer")}
               <button class="tiny" data-save-client="${c.id}">Save</button>
               <button class="tiny ghost" data-cancel="1">Cancel</button></div>
               <p class="sub" style="margin:6px 0 0">Changing the rate only affects shifts you log from now on. Shifts already recorded keep the rate they were logged at.</p></td></tr>`
          : `<tr><td>${c.name}<br><span class="sub">${money(c.defaultRate ?? 3000)}/hr · ${RULE_LABEL[c.defaultTimeRule ?? "fullPerPayer"]}</span></td><td class="n">
               <button class="tiny ghost" data-edit="${c.id}">Edit</button>
               ${trash("client", c.id, c.name, "person")}</td></tr>`).join("")
          || `<tr><td class="empty">Nobody yet</td></tr>`}
      </tbody></table>
      <div class="row"><input id="cname" placeholder="Name" /><input id="crate" type="number" step="0.5" value="30.00" style="max-width:120px" title="Hourly rate" /><button id="addc">Add</button></div>
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
            <td>${r.people}</td><td class="n">${dur(r.minutes)}</td><td class="n">${money(r.pay)}</td></tr>`).join("")}
      </table>` : `<p class="empty">No finished shifts yet.</p>`}
      ${ui.openShift ? shiftDetail(allShifts.find((s) => s.id === ui.openShift)!, expenses, done, name) : ""}
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
               <input id="ea" type="number" step="0.01" value="${(e.totalAmount / 100).toFixed(2)}" />
               <button class="tiny" data-save-exp="${e.id}">Save</button>
               <button class="tiny ghost" data-cancel="1">Cancel</button></div></td></tr>`
          : `<tr><td>${e.description}</td><td>${day(e.occurredAt)}</td><td class="n">${money(e.totalAmount)}</td>
             <td class="n"><button class="tiny ghost" data-edit="${e.id}">Edit</button>
             ${trash("expense", e.id, `${e.description} (${money(e.totalAmount)})`, "expense")}</td></tr>`).join("")}
      </table>` : `<p class="empty">None yet.</p>`}
      <div class="row"><input id="edesc" placeholder="What for?" /><input id="eamt" type="number" placeholder="0.00" step="0.01" /><button id="adde">Add</button></div>
    </section>

    <section class="card">
      <h2>Owed</h2>
      ${owed.length ? `<table>
        <tr><th data-sort="owed:payerPartyId">Payer ${arrow(ui.sort.owed, "payerPartyId")}</th>
            <th class="n" data-sort="owed:unclaimed">Unclaimed ${arrow(ui.sort.owed, "unclaimed")}</th>
            <th class="n" data-sort="owed:submitted">Submitted ${arrow(ui.sort.owed, "submitted")}</th>
            <th class="n" data-sort="owed:paid">Paid ${arrow(ui.sort.owed, "paid")}</th></tr>
        ${sorted(owed, ui.sort.owed).map((r) => `<tr><td>${name(r.payerPartyId.replace(/^payer-/, ""))}</td>
          <td class="n">${money(r.unclaimed)}</td><td class="n">${money(r.submitted)}</td><td class="n">${money(r.paid)}</td></tr>`).join("")}
      </table>` : `<p class="empty">Nothing owed yet.</p>`}
    </section>

    <section class="card">
      <h2>Backup</h2>
      <div class="row"><button id="exp" class="pink">Download log</button><label class="file">Restore<input id="imp" type="file" accept="application/json" hidden /></label></div>
      <p class="msg">${ui.msg}</p>
    </section>
    ${confirmModal()}`;

  wire(open, clients, done, expenses);
}

function confirmModal() {
  const c = ui.confirm;
  if (!c) return "";
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

function shiftDetail(s: Shift, expenses: Expense[], done: Shift[], name: (id: string) => string) {
  const attached = expenses.filter((e) => e.shiftId === s.id);
  const others = done.filter((d) => d.id !== s.id);
  return `<div class="detail">
    <h3>Shift detail</h3>
    <div class="row"><label style="flex:0 0 auto">Start</label><input id="sst" type="datetime-local" value="${forInput(s.startAt)}" />
      <label style="flex:0 0 auto">End</label><input id="sen" type="datetime-local" value="${forInput(s.endAt!)}" />
      <button class="tiny" data-save-shift="${s.id}">Save</button></div>
    <p style="margin:10px 0 4px">${s.participants.map((p) => `<span class="pill">${name(p.clientId)} ${hhmm(p.inAt)}\u2013${hhmm(p.outAt)} @ ${money(p.payRate)}/hr</span>`).join("")}</p>
    <p style="margin:6px 0">${attached.length ? attached.map((e) => `<span class="pill warn">${e.description} ${money(e.totalAmount)}</span>`).join("") : `<span class="empty">No expenses attached</span>`}</p>
    <div class="acts">
      <button class="tiny ghost" data-split="${s.id}">Split in half</button>
      ${others.length ? `<select id="mergeWith" style="width:auto">${others.map((o) => `<option value="${o.id}">${day(o.startAt)} ${hhmm(o.startAt)}</option>`).join("")}</select>
        <button class="tiny pink" data-merge="${s.id}">Merge with</button>` : ""}
      ${trash("shift", s.id, `${day(s.startAt)} ${hhmm(s.startAt)}–${hhmm(s.endAt!)}`, "shift")}
      <button class="tiny ghost" data-cancel="1">Close</button>
    </div>
  </div>`;
}

function wire(open: Shift | undefined, clients: Client[], done: Shift[], expenses: Expense[]) {
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

  all("[data-edit]", (el) => el.onclick = (e) => { e.stopPropagation(); ui.editing = el.dataset.edit!; render(); });
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
    const rule = ($("rrule") as unknown as HTMLSelectElement).value;
    await emit("client", el.dataset.saveClient!, { name: v, defaultRate: rate, defaultTimeRule: rule });
    ui.editing = null;
  }));

  all("[data-save-exp]", (el) => el.onclick = () => go(async () => {
    const cents = Math.round(parseFloat($("ea")!.value || "0") * 100);
    await emit("expense", el.dataset.saveExp!, { description: $("ed")!.value || "Expense", totalAmount: cents });
    ui.editing = null;
  }));

  all("[data-save-shift]", (el) => el.onclick = () => go(async () => {
    const s = done.find((d) => d.id === el.dataset.saveShift)!;
    const startAt = fromInput($("sst")!.value);
    const endAt = fromInput($("sen")!.value);
    if (Date.parse(endAt) <= Date.parse(startAt)) throw new Error("The end must come after the start.");
    await emit("shift", s.id, { startAt, endAt, participants: s.participants.map((p) => ({ ...p, inAt: startAt, outAt: endAt })) });
    ui.msg = "Shift updated.";
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

  // Picking a different person shows that person's standing rate.
  const syncRate = (selId: string, rateId: string) => {
    const sel = $(selId) as unknown as HTMLSelectElement | null;
    if (!sel) return;
    sel.onchange = () => {
      const c = clients.find((x) => x.id === sel.value);
      if (c) $(rateId)!.value = ((c.defaultRate ?? 3000) / 100).toFixed(2);
    };
  };
  syncRate("who", "rate");
  syncRate("arrive", "arate");

  if ($("addc")) $("addc")!.onclick = () => go(async () => {
    const v = $("cname")!.value.trim();
    if (!v) return;
    const rate = Math.round(parseFloat($("crate")!.value || "30") * 100);
    await emit("client", newId(), { name: v, defaultRate: rate, occurredAt: nowInstant(), recordedAt: nowInstant() });
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
    if (!cents) return;
    const clientId = clients[0]?.id ?? "unknown";
    await emit("expense", newId(), {
      description: $("edesc")!.value || "Expense", totalAmount: cents, category: "other",
      occurredAt: nowInstant(), recordedAt: nowInstant(), shiftId: open?.id ?? null,
      receiptAttachmentIds: [], reimbursementStatus: "unclaimed",
      splits: [{ clientId, payerPartyId: `payer-${clientId}`, amount: cents }],
    });
  });

  if ($("exp")) $("exp")!.onclick = async () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([await exportEventLog(db)], { type: "application/json" }));
    a.download = `respite-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  };

  if ($("imp")) $("imp")!.onchange = (e: any) => go(async () => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = await importEventLog(db, await f.text());
    ui.msg = `Restored ${r.imported}, already had ${r.skipped}${r.conflicts.length ? `, ${r.conflicts.length} kept back` : ""}.`;
  });
}

db.open().then(render).catch((err) => {
  app.innerHTML = `<div class="card"><h2>Could not open the local database</h2><pre>${err.message}</pre></div>`;
});
