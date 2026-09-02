import { describe, it, expect } from "vitest";
import { buildInvoice } from "../../src/domain/invoice";
import type { Adjustment, Expense, Shift, Trip } from "../../src/domain/entities";

const T = (h: number) => `2026-03-01T${String(h).padStart(2, "0")}:00:00.000Z`;
const base = { occurredAt: T(9), recordedAt: T(9), zone: "UTC", tags: [], customFields: {} };

const shift = (status = "unclaimed"): Shift => ({
  ...base, id: "s1", startAt: T(9), endAt: T(12), isIncident: false,
  reimbursementStatus: status as any,
  participants: [{ clientId: "rory", payerPartyId: "p1", inAt: T(9), outAt: T(12), payRate: 2000, timeRule: "fullPerPayer" }],
});
const expense = (): Expense => ({
  ...base, id: "x1", totalAmount: 1500, category: "other" as any, description: "Lunch",
  receiptAttachmentIds: ["a1"], reimbursementStatus: "unclaimed",
  splits: [{ clientId: "rory", payerPartyId: "p1", amount: 1500 }],
});
const trip = (): Trip => ({
  ...base, id: "t1", distance: 12, distanceUnit: "km", purpose: "Swimming", isClaimable: true,
  reimbursementStatus: "unclaimed",
  splits: [{ clientId: "rory", payerPartyId: "p1", distanceShare: 12, rateApplied: 68, claimAmount: 816 }],
});
const adj = (delta: number, note: string): Adjustment => ({
  ...base, id: "adj1", payerPartyId: "p1", amountDelta: delta, note,
});

describe("buildInvoice", () => {
  it("itemises time, expenses and mileage so the cost can be checked", () => {
    const inv = buildInvoice("p1", "rory", "Rory", [shift()], [expense()], [trip()], []);
    expect(inv.time).toBe(6000);      // 3h at 20.00
    expect(inv.expenses).toBe(1500);
    expect(inv.mileage).toBe(816);
    expect(inv.total).toBe(8316);
    // Every line carries what it is made of, not just a figure.
    expect(inv.lines.find((l) => l.kind === "time")!.quantity).toBe("3.00 h at 20.00/h");
    expect(inv.lines.find((l) => l.kind === "mileage")!.quantity).toBe("12.0 km at 0.68/km");
  });

  it("the total always equals the sum of its lines", () => {
    const inv = buildInvoice("p1", "rory", "Rory", [shift()], [expense()], [trip()], [adj(-500, "Agreed discount")]);
    const summed = inv.lines.reduce((t, l) => t + l.amount, 0) + inv.adjustments;
    expect(summed).toBe(inv.total);
    expect(inv.total).toBe(8316 - 500);
  });

  it("an adjustment never alters the record it concerns", () => {
    const s = shift();
    const before = JSON.stringify(s);
    buildInvoice("p1", "rory", "Rory", [s], [], [], [adj(-1000, "Late finish disputed")]);
    // The shift is what happened. Only the claim changes.
    expect(JSON.stringify(s)).toBe(before);
  });

  it("a draft can show the adjustments a final would fold into the total", () => {
    const inv = buildInvoice("p1", "rory", "Rory", [shift()], [], [], [adj(-500, "Agreed discount")]);
    expect(inv.adjustmentLines).toHaveLength(1);
    expect(inv.adjustmentLines[0].note).toBe("Agreed discount");
    expect(inv.adjustments).toBe(-500);
  });

  it("leaves out another payer's money entirely", () => {
    const other = { ...expense(), splits: [{ clientId: "x", payerPartyId: "p2", amount: 9999 }] };
    const inv = buildInvoice("p1", "rory", "Rory", [], [other], [], []);
    expect(inv.total).toBe(0);
    expect(inv.lines).toEqual([]);
  });

  it("bills only what has not been settled", () => {
    const paid = { ...shift("paid") };
    const inv = buildInvoice("p1", "rory", "Rory", [paid], [], [], []);
    expect(inv.total).toBe(0);
  });

  it("puts the lines in the order the work happened", () => {
    const inv = buildInvoice("p1", "rory", "Rory", [shift()], [expense()], [trip()], []);
    const dates = inv.lines.map((l) => l.when);
    expect([...dates].sort()).toEqual(dates);
  });
});
