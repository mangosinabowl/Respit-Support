import { describe, it, expect } from "vitest";
import { checkData } from "../../src/domain/integrity";
import { replay } from "../../src/domain/replay";
import type { DomainEvent } from "../../src/domain/events";

let n = 0;
const ev = (entityType: string, entityId: string, fields: Record<string, unknown>): DomainEvent => {
  n += 1;
  return { eventId: `e${n}`, entityType, entityId, fields, recordedAt: `2026-03-01T00:00:0${n % 10}.000Z`, deviceId: "d", seq: n } as DomainEvent;
};
const T = (h: number) => `2026-03-01T${String(h).padStart(2, "0")}:00:00.000Z`;
const base = { occurredAt: T(9), recordedAt: T(9), zone: "UTC", tags: [], customFields: {} };

const shift = (id: string, clients: string[]) => ev("shift", id, {
  ...base, startAt: T(9), endAt: T(12), isIncident: false, reimbursementStatus: "unclaimed",
  participants: clients.map((c) => ({ clientId: c, payerPartyId: `p-${c}`, inAt: T(9), outAt: T(12), payRate: 2000, timeRule: "fullPerPayer" })),
});

describe("checkData", () => {
  it("is quiet when everything hangs together", () => {
    const store = replay([
      shift("s1", ["rory"]),
      ev("expense", "x1", { ...base, description: "Lunch", totalAmount: 1000, shiftId: "s1", receiptAttachmentIds: [], reimbursementStatus: "unclaimed", splits: [{ clientId: "rory", payerPartyId: "p-rory", amount: 1000 }] }),
    ]);
    expect(checkData(store)).toEqual([]);
  });

  it("catches an invoice whose total does not match its own parts", () => {
    const store = replay([ev("submission", "sub1", {
      ...base, kind: "invoice", payerPartyId: "p-rory", clientId: "rory", clientName: "Rory",
      amount: 12000, time: 22000, expenses: 0, mileage: 0, adjustments: 0,
      covers: { shifts: [], expenses: [], trips: [] },
    })]);
    const found = checkData(store);
    expect(found).toHaveLength(1);
    expect(found[0].detail).toContain("$120.00");
    expect(found[0].detail).toContain("$220.00");
  });

  it("catches a receipt on a shift its people were not on", () => {
    const store = replay([
      shift("s1", ["rory"]),
      ev("expense", "x1", { ...base, description: "Lunch", totalAmount: 1000, shiftId: "s1", receiptAttachmentIds: [], reimbursementStatus: "unclaimed", splits: [{ clientId: "mia", payerPartyId: "p-mia", amount: 1000 }] }),
    ]);
    expect(checkData(store)[0].detail).toContain("not present for");
  });

  it("catches an item attached to a shift that is gone", () => {
    const store = replay([
      ev("expense", "x1", { ...base, description: "Lunch", totalAmount: 1000, shiftId: "missing", receiptAttachmentIds: [], reimbursementStatus: "unclaimed", splits: [{ clientId: "rory", payerPartyId: "p-rory", amount: 1000 }] }),
    ]);
    expect(checkData(store)[0].detail).toContain("no longer exists");
  });

  it("catches work marked sent that belongs to no invoice", () => {
    const store = replay([ev("shift", "s1", {
      ...base, startAt: T(9), endAt: T(12), isIncident: false, reimbursementStatus: "submitted",
      participants: [{ clientId: "rory", payerPartyId: "p-rory", inAt: T(9), outAt: T(12), payRate: 2000, timeRule: "fullPerPayer" }],
    })]);
    expect(checkData(store)[0].detail).toContain("cannot be chased");
  });

  it("catches a shift that ends before it starts", () => {
    const store = replay([ev("shift", "s1", {
      ...base, startAt: T(12), endAt: T(9), isIncident: false, reimbursementStatus: "unclaimed",
      participants: [{ clientId: "rory", payerPartyId: "p-rory", inAt: T(12), outAt: T(9), payRate: 2000, timeRule: "fullPerPayer" }],
    })]);
    expect(checkData(store).some((p) => p.detail.includes("ends before it starts"))).toBe(true);
  });

  it("catches a note left pointing at a deleted shift", () => {
    const store = replay([
      ev("note", "n1", { ...base, body: "Good day", attachedToType: "shift", attachedToId: "gone", visibility: { me: true, payer: false, guardian: false } }),
    ]);
    expect(checkData(store)[0].detail).toContain("no longer exists");
  });
});
