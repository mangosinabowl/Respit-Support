import { describe, it, expect } from "vitest";
import { NOTE_PRIVATE, type Shift, type Expense } from "../../src/domain/entities";

describe("entities", () => {
  it("defaults a note to private", () => {
    expect(NOTE_PRIVATE).toEqual({ me: true, payer: false, guardian: false });
  });

  it("types a shift with participants carrying their own times", () => {
    const shift: Shift = {
      id: "s1",
      occurredAt: "2026-03-01T22:00:00.000Z",
      recordedAt: "2026-03-01T22:00:00.000Z",
      zone: "America/Los_Angeles",
      startAt: "2026-03-01T22:00:00.000Z",
      endAt: "2026-03-02T01:00:00.000Z",
      participants: [
        {
          clientId: "c1",
          payerPartyId: "p1",
          inAt: "2026-03-01T22:00:00.000Z",
          outAt: "2026-03-02T01:00:00.000Z",
          payRate: 2500,
          timeRule: "fullPerPayer",
        },
      ],
      isIncident: false,
      reimbursementStatus: "unclaimed",
      tags: [],
      customFields: {},
    };
    expect(shift.participants[0].payRate).toBe(2500);
  });

  it("types an expense with splits in integer cents", () => {
    const expense: Expense = {
      id: "e1",
      occurredAt: "2026-03-01T23:00:00.000Z",
      recordedAt: "2026-03-01T23:05:00.000Z",
      zone: "America/Los_Angeles",
      totalAmount: 3400,
      category: "food",
      description: "Lunch",
      receiptAttachmentIds: [],
      splits: [
        { clientId: "c1", payerPartyId: "p1", amount: 1134 },
        { clientId: "c2", payerPartyId: "p2", amount: 2266 },
      ],
      reimbursementStatus: "unclaimed",
      tags: [],
      customFields: {},
    };
    const sum = expense.splits.reduce((t, s) => t + s.amount, 0);
    expect(sum).toBe(expense.totalAmount);
  });
});
