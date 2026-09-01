import { RespiteDb, appendEvent, hydrate, nextSeq, deviceId, exportEventLog, importEventLog } from "../store/db";
import { makeEvent } from "../domain/events";
import { live } from "../domain/replay";
import { owedByPayer } from "../domain/queries";
import { newId, nowInstant } from "../domain/primitives";
import type { Shift, Expense, Client } from "../domain/entities";

const db = new RespiteDb();
const dev = deviceId();
const app = document.getElementById("app")!;
// Canadian dollars. Amounts are integer cents everywhere underneath.
const money = (c: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(c / 100);
const time = (s: string) => new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

async function emit(fields: Parameters<typeof makeEvent>[2], type: Parameters<typeof makeEvent>[0], id: string) {
  await appendEvent(db, makeEvent(type, id, fields, dev, await nextSeq(db, dev)));
}

async function render() {
  const store = await hydrate(db);
  const clients = live(store, "client") as unknown as Client[];
  const shifts = (live(store, "shift") as unknown as Shift[]).sort((a, b) => b.startAt.localeCompare(a.startAt));
  const expenses = live(store, "expense") as unknown as Expense[];
  const open = shifts.find((s) => !s.endAt);
  const owed = owedByPayer(store);

  app.innerHTML = `
    <header><h1>Respite Support</h1><span class="dev">device ${dev.slice(0, 8)}</span></header>

    <section class="card ${open ? "live" : ""}">
      <h2>${open ? "Shift running" : "No shift running"}</h2>
      ${open
        ? `<p class="big">since ${time(open.startAt)}</p>
           <p class="who">${open.participants.map((p) => clients.find((c) => c.id === p.clientId)?.name ?? p.clientId).join(", ") || "no one added"}</p>
           <button id="end" class="primary">End shift</button>`
        : clients.length
          ? `<label>Who are you with?</label>
             <select id="who">${clients.map((c) => `<option value="${c.id}">${c.name}</option>`).join("")}</select>
             <label>Rate $/hr (CAD)</label><input id="rate" type="number" value="30" step="0.5" />
             <button id="start" class="primary">Start shift</button>`
          : `<p class="empty">Add someone you support first.</p>`}
    </section>

    <section class="card">
      <h2>People</h2>
      <ul class="list">${clients.map((c) => `<li>${c.name}</li>`).join("") || `<li class="empty">Nobody yet</li>`}</ul>
      <div class="row"><input id="cname" placeholder="Name" /><button id="addc">Add</button></div>
    </section>

    <section class="card">
      <h2>Expense</h2>
      <div class="row">
        <input id="edesc" placeholder="What for?" />
        <input id="eamt" type="number" placeholder="0.00" step="0.01" />
        <button id="adde">Add</button>
      </div>
      <ul class="list">${expenses.slice(-5).reverse().map((e) => `<li>${e.description} <b>${money(e.totalAmount)}</b></li>`).join("") || `<li class="empty">None yet</li>`}</ul>
    </section>

    <section class="card">
      <h2>Owed</h2>
      ${owed.length
        ? `<table><tr><th>Payer</th><th>Unclaimed</th><th>Submitted</th><th>Paid</th></tr>
           ${owed.map((r) => `<tr><td>${r.payerPartyId}</td><td class="n">${money(r.unclaimed)}</td><td class="n">${money(r.submitted)}</td><td class="n">${money(r.paid)}</td></tr>`).join("")}</table>`
        : `<p class="empty">Nothing owed yet.</p>`}
    </section>

    <section class="card">
      <h2>Backup</h2>
      <div class="row"><button id="exp">Download log</button><label class="file">Restore<input id="imp" type="file" accept="application/json" hidden /></label></div>
      <p id="msg" class="msg"></p>
    </section>

    <section class="card">
      <h2>Recent shifts</h2>
      <ul class="list">${shifts.filter((s) => s.endAt).slice(0, 5).map((s) => `<li>${new Date(s.startAt).toLocaleDateString()} ${time(s.startAt)}–${time(s.endAt!)}</li>`).join("") || `<li class="empty">None yet</li>`}</ul>
    </section>`;

  const on = (id: string, ev: string, fn: (e: any) => void) => document.getElementById(id)?.addEventListener(ev, fn);

  on("addc", "click", async () => {
    const el = document.getElementById("cname") as HTMLInputElement;
    if (!el.value.trim()) return;
    await emit({ name: el.value.trim(), occurredAt: nowInstant(), recordedAt: nowInstant() }, "client", newId());
    render();
  });

  on("start", "click", async () => {
    const clientId = (document.getElementById("who") as HTMLSelectElement).value;
    const payRate = Math.round(parseFloat((document.getElementById("rate") as HTMLInputElement).value) * 100);
    const now = nowInstant();
    await emit({
      startAt: now, endAt: null, occurredAt: now, recordedAt: now, zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      participants: [{ clientId, payerPartyId: `payer-${clientId}`, inAt: now, outAt: now, payRate, timeRule: "fullPerPayer" }],
      isIncident: false, reimbursementStatus: "unclaimed", tags: [], customFields: {},
    }, "shift", newId());
    render();
  });

  on("end", "click", async () => {
    const now = nowInstant();
    await emit({ endAt: now, participants: open!.participants.map((p) => ({ ...p, outAt: now })) }, "shift", open!.id);
    render();
  });

  on("adde", "click", async () => {
    const d = document.getElementById("edesc") as HTMLInputElement;
    const a = document.getElementById("eamt") as HTMLInputElement;
    const cents = Math.round(parseFloat(a.value || "0") * 100);
    if (!cents) return;
    const clientId = clients[0]?.id ?? "unknown";
    await emit({
      description: d.value || "Expense", totalAmount: cents, category: "other", occurredAt: nowInstant(), recordedAt: nowInstant(),
      shiftId: open?.id ?? null, receiptAttachmentIds: [], reimbursementStatus: "unclaimed",
      splits: [{ clientId, payerPartyId: `payer-${clientId}`, amount: cents }],
    }, "expense", newId());
    render();
  });

  on("exp", "click", async () => {
    const blob = new Blob([await exportEventLog(db)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `respite-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
  });

  on("imp", "change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = await importEventLog(db, await file.text());
    (document.getElementById("msg") as HTMLElement).textContent =
      `Restored ${r.imported}, already had ${r.skipped}${r.conflicts.length ? `, ${r.conflicts.length} conflict(s) kept back` : ""}.`;
    render();
  });
}

db.open().then(render).catch((err) => {
  app.innerHTML = `<div class="card"><h2>Could not open the local database</h2><pre>${err.message}</pre></div>`;
});
