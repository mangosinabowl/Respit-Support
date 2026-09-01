import { describe, it, expect } from "vitest";
import { owedByPayer } from "../../src/domain/queries";
import { replay } from "../../src/domain/replay";
import type { DomainEvent } from "../../src/domain/events";

let seq = 0;
function ev(entityType: DomainEvent["entityType"], id: string, fields: Record<string, unknown>): DomainEvent {
  seq += 1;
  return { eventId: `e${seq}`, entityType, entityId: id, fields, recordedAt: `2026-03-0${seq}T00:00:00.000Z`, deviceId: "dev-a", seq };
}

const T = (h: number) => `2026-03-01T${String(h).padStart(2, "0")}:00:00.000Z`;

describe("owedByPayer", () => {
  it("totals unclaimed time and expenses per payer", () => {
    const store = replay([
      ev("shift", "s1", {
        startAt: T(15), endAt: T(18), reimbursementStatus: "unclaimed",
        participants: [{ clientId: "c1", payerPartyId: "p1", inAt: T(15), outAt: T(18), payRate: 3000, timeRule: "fullPerPayer" }],
      }),
      ev("expense", "e1", {
        totalAmount: 3400, reimbursementStatus: "unclaimed",
        splits: [{ clientId: "c1", payerPartyId: "p1", amount: 3400 }],
      }),
    ]);
    const rows = owedByPayer(store);
    expect(rows).toEqual([{ payerPartyId: "p1", unclaimed: 9000 + 3400, submitted: 0, paid: 0 }]);
  });

  it("separates unclaimed, submitted and paid", () => {
    const store = replay([
      ev("expense", "e1", { totalAmount: 1000, reimbursementStatus: "unclaimed", splits: [{ clientId: "c1", payerPartyId: "p1", amount: 1000 }] }),
      ev("expense", "e2", { totalAmount: 2000, reimbursementStatus: "submitted", splits: [{ clientId: "c1", payerPartyId: "p1", amount: 2000 }] }),
      ev("expense", "e3", { totalAmount: 3000, reimbursementStatus: "paid", splits: [{ clientId: "c1", payerPartyId: "p1", amount: 3000 }] }),
    ]);
    expect(owedByPayer(store)).toEqual([{ payerPartyId: "p1", unclaimed: 1000, submitted: 2000, paid: 3000 }]);
  });

  it("keeps payers separate and sorted", () => {
    const store = replay([
      ev("expense", "e1", { totalAmount: 1000, reimbursementStatus: "unclaimed", splits: [{ clientId: "c1", payerPartyId: "pB", amount: 1000 }] }),
      ev("expense", "e2", { totalAmount: 2000, reimbursementStatus: "unclaimed", splits: [{ clientId: "c2", payerPartyId: "pA", amount: 2000 }] }),
    ]);
    expect(owedByPayer(store).map((r) => r.payerPartyId)).toEqual(["pA", "pB"]);
  });

  it("excludes deleted records", () => {
    const store = replay([
      ev("expense", "e1", { totalAmount: 1000, reimbursementStatus: "unclaimed", splits: [{ clientId: "c1", payerPartyId: "p1", amount: 1000 }] }),
      ev("expense", "e1", { deleted: true }),
    ]);
    expect(owedByPayer(store)).toEqual([]);
  });

  it("excludes expenses marked not reimbursable", () => {
    const store = replay([
      ev("expense", "e1", { totalAmount: 1000, reimbursementStatus: "notReimbursable", splits: [{ clientId: "c1", payerPartyId: "p1", amount: 1000 }] }),
    ]);
    expect(owedByPayer(store)).toEqual([]);
  });

  it("returns nothing for an empty store", () => {
    expect(owedByPayer(replay([]))).toEqual([]);
  });
});
