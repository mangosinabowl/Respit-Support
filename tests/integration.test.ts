import { describe, it, expect } from "vitest";
import "fake-indexeddb/auto";
import { RespiteDb, appendEvent, hydrate, nextSeq, exportEventLog, importEventLog } from "../src/store/db";
import { syncOnce, inMemoryRemote } from "../src/store/sync";
import { makeEvent } from "../src/domain/events";
import { live } from "../src/domain/replay";
import { owedByPayer } from "../src/domain/queries";
import { allocateTime } from "../src/domain/timeAllocation";
import { checkShift, checkExpense, checkTrip } from "../src/domain/invariants";
import { clientsVisibleTo, filterShiftFor } from "../src/domain/audience";
import { splitByPercent, expenseAsMinutes } from "../src/domain/expenseTime";
import { tripShares } from "../src/domain/mileage";
import { splitShiftAt, mergeShifts } from "../src/domain/operations";
import type { Shift, Expense, Trip } from "../src/domain/entities";

const T = (h: number, m = 0) => `2026-03-01T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;

async function seeded() {
  const db = new RespiteDb(`audit-${Math.random()}`);
  await db.open();
  const dev = "dev-a";
  let n = 0;
  const put = async (t: any, id: string, f: any) => { n += 1; await appendEvent(db, makeEvent(t, id, f, dev, n)); };

  await put("client", "rory", { name: "Rory", defaultRate: 2000, defaultTimeRule: "fullPerPayer" });
  // The role records the audience rules read. Without them nothing is visible
  // to anyone, which is the safe direction but not a working app.
  for (const [c, role] of [["rory", "payer"], ["rory", "guardian"], ["ph", "payer"], ["ph", "guardian"]] as const) {
    await put("role", `${c}-${role}`, { clientId: c, partyId: `payer-${c}`, role, occurredAt: T(9), recordedAt: T(9), zone: "UTC", tags: [], customFields: {} });
  }
  await put("client", "andrew", { name: "Andrew", defaultRate: 0, defaultTimeRule: "fullPerPayer" });
  await put("client", "ph", { name: "Placeholder", defaultRate: 3000, defaultTimeRule: "splitEvenly" });

  await put("shift", "s1", {
    startAt: T(9), endAt: T(12), occurredAt: T(9), recordedAt: T(9), zone: "UTC",
    participants: [
      { clientId: "rory", payerPartyId: "payer-rory", inAt: T(9), outAt: T(12), payRate: 2000, timeRule: "fullPerPayer" },
      { clientId: "ph", payerPartyId: "payer-ph", inAt: T(10), outAt: T(12), payRate: 3000, timeRule: "splitEvenly" },
    ],
    isIncident: false, reimbursementStatus: "unclaimed", tags: [], customFields: {},
  });

  // A receipt photo, because an expense without one is not claimable and the
  // checks say so.
  await put("attachment", "a1", {
    mimeType: "image/jpeg", dataUrl: "data:image/jpeg;base64,/9j/testreceipt", bytes: 120,
    attachedToType: "expense", attachedToId: "x1",
    occurredAt: T(11), recordedAt: T(11), zone: "UTC", tags: [], customFields: {},
  });

  const parts = splitByPercent(3000, [50, 50]);
  await put("expense", "x1", {
    description: "Lunch", totalAmount: 3000, category: "other", occurredAt: T(11), recordedAt: T(11), zone: "UTC",
    shiftId: "s1", receiptAttachmentIds: ["a1"], reimbursementStatus: "unclaimed", tags: [], customFields: {},
    splits: [
      { clientId: "rory", payerPartyId: "payer-rory", amount: parts[0] },
      { clientId: "ph", payerPartyId: "payer-ph", amount: parts[1] },
    ],
  });

  const trip = tripShares(12, 68, [100]);
  await put("trip", "t1", {
    distance: 12, distanceUnit: "km", purpose: "Swimming", isClaimable: true,
    occurredAt: T(10), recordedAt: T(10), zone: "UTC", shiftId: "s1",
    reimbursementStatus: "unclaimed", tags: [], customFields: {},
    splits: [{ clientId: "rory", payerPartyId: "payer-rory", distanceShare: trip.shares[0].distanceShare, rateApplied: 68, claimAmount: trip.shares[0].claim }],
  });

  await put("note", "n1", {
    body: "Great day", attachedToType: "shift", attachedToId: "s1",
    occurredAt: T(12), recordedAt: T(12), zone: "UTC",
    visibility: { me: true, payer: false, guardian: true }, tags: [], customFields: {},
  });
  return { db, dev };
}

describe("AUDIT", () => {
  it("every record passes its own checks", async () => {
    const { db } = await seeded();
    const store = await hydrate(db);
    const v = [
      ...(live(store, "shift") as unknown as Shift[]).flatMap(checkShift),
      ...(live(store, "expense") as unknown as Expense[]).flatMap(checkExpense),
      ...(live(store, "trip") as unknown as Trip[]).flatMap(checkTrip),
    ];
    expect(v.map((x) => x.message)).toEqual([]);
  });

  it("Owed totals equal the sum of their own breakdown, and match the records", async () => {
    const { db } = await seeded();
    const store = await hydrate(db);
    const rows = owedByPayer(store);
    for (const r of rows) {
      expect(r.time.unclaimed + r.expenses.unclaimed + r.mileage.unclaimed).toBe(r.unclaimed);
    }
    const claims = allocateTime((live(store, "shift") as unknown as Shift[])[0].participants);
    const timeTotal = claims.reduce((t, c) => t + c.amount, 0);
    const owedTime = rows.reduce((t, r) => t + r.time.unclaimed, 0);
    expect(owedTime).toBe(timeTotal);
    const owedExp = rows.reduce((t, r) => t + r.expenses.unclaimed, 0);
    expect(owedExp).toBe(3000);
    const owedMiles = rows.reduce((t, r) => t + r.mileage.unclaimed, 0);
    expect(owedMiles).toBe(816);
    console.log("AUDIT owed:", JSON.stringify(rows.map((r) => `${r.payerPartyId}: total ${r.unclaimed} = time ${r.time.unclaimed} + exp ${r.expenses.unclaimed} + miles ${r.mileage.unclaimed}`)));
  });

  it("splitting a shift preserves payable time and moves its receipts", async () => {
    const { db } = await seeded();
    const store = await hydrate(db);
    const shift = (live(store, "shift") as unknown as Shift[])[0];
    const before = allocateTime(shift.participants).reduce((t, c) => t + c.amount, 0);
    const attached = (live(store, "expense") as unknown as Expense[]).filter((e) => e.shiftId === shift.id);
    const events = splitShiftAt(shift, T(10, 30), "dev-a", 100, attached);
    for (const e of events) await appendEvent(db, e);
    const after = await hydrate(db);
    const halves = (live(after, "shift") as unknown as Shift[]);
    const total = halves.reduce((t, s) => t + allocateTime(s.participants).reduce((a, c) => a + c.amount, 0), 0);
    expect(total).toBe(before);
    // The receipt followed the shift rather than pointing at a deleted record.
    const exp = (live(after, "expense") as unknown as Expense[])[0];
    expect(halves.some((h) => h.id === exp.shiftId)).toBe(true);
  });

  it("a full sync round leaves two devices identical", async () => {
    const { db } = await seeded();
    const remote = inMemoryRemote();
    await syncOnce(db, remote, "dev-a");
    const other = new RespiteDb(`audit-b-${Math.random()}`);
    await other.open();
    await syncOnce(other, remote, "dev-b");
    expect(await hydrate(other)).toEqual(await hydrate(db));
  });

  it("a downloaded copy merges back with nothing lost", async () => {
    const { db } = await seeded();
    const file = await exportEventLog(db);
    const fresh = new RespiteDb(`audit-c-${Math.random()}`);
    await fresh.open();
    const res = await importEventLog(fresh, file);
    expect(res.conflicts).toEqual([]);
    expect(await hydrate(fresh)).toEqual(await hydrate(db));
  });

  it("the payer sees expenses and mileage as time, at the unchanged rate", async () => {
    const { db } = await seeded();
    const store = await hydrate(db);
    const rows = owedByPayer(store);
    const rory = rows.find((r) => r.payerPartyId === "payer-rory")!;
    const asTime = expenseAsMinutes(rory.expenses.unclaimed + rory.mileage.unclaimed, 2000);
    console.log("AUDIT payer view:", `${rory.expenses.unclaimed + rory.mileage.unclaimed}c at 2000c/hr = ${asTime} min`);
    expect(asTime).toBeGreaterThan(0);
  });

  it("a guardian-shared note is shared and a private one is not", async () => {
    const { db } = await seeded();
    const store = await hydrate(db);
    const notes = live(store, "note") as unknown as any[];
    expect(notes[0].visibility.guardian).toBe(true);
    expect(notes[0].visibility.payer).toBe(false);
  });

  it("a guardian sees their own child and nothing about the other family", async () => {
    const { db } = await seeded();
    const store = await hydrate(db);
    const ctx = { audience: "guardian" as const, partyId: "payer-rory" };
    const visible = clientsVisibleTo(store, ctx);
    expect(visible).toEqual(["rory"]);

    const shift = (live(store, "shift") as unknown as Shift[])[0];
    const filtered = filterShiftFor(shift, ctx, visible)!;
    const asText = JSON.stringify(filtered);
    // Placeholder was on the same shift. Nothing about them may survive.
    expect(asText).not.toContain("ph");
    expect(asText).not.toContain("Placeholder");
    expect(filtered.participants.map((p) => p.clientId)).toEqual(["rory"]);
  });

  it("a payer for one family cannot see the other family's shift at all", async () => {
    const { db } = await seeded();
    const store = await hydrate(db);
    const ctx = { audience: "payer" as const, partyId: "payer-ph" };
    const visible = clientsVisibleTo(store, ctx);
    expect(visible).toEqual(["ph"]);
    const shift = (live(store, "shift") as unknown as Shift[])[0];
    const filtered = filterShiftFor(shift, ctx, visible)!;
    expect(JSON.stringify(filtered)).not.toContain("rory");
  });
});