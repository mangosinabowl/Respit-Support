import { describe, it, expect } from "vitest";
import { NOTE_PRIVATE, type Shift, type Expense, type Trip } from "../../src/domain/entities";

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

  it("allows expense shiftId to be null to clear the field (JSON-serializable field-clear per replay invariant)", () => {
    const expense: Expense = {
      id: "e2",
      occurredAt: "2026-03-01T23:00:00.000Z",
      recordedAt: "2026-03-01T23:05:00.000Z",
      zone: "America/Los_Angeles",
      totalAmount: 1000,
      category: "food",
      description: "Snack",
      shiftId: null,
      receiptAttachmentIds: [],
      splits: [{ clientId: "c1", payerPartyId: "p1", amount: 1000 }],
      reimbursementStatus: "unclaimed",
      tags: [],
      customFields: {},
    };
    expect(expense.shiftId).toBeNull();
  });

  it("types a shift with endAt as null to represent a running timer (null, not undefined)", () => {
    const runningShift: Shift = {
      id: "s2",
      occurredAt: "2026-03-01T22:00:00.000Z",
      recordedAt: "2026-03-01T22:00:00.000Z",
      zone: "America/Los_Angeles",
      startAt: "2026-03-01T22:00:00.000Z",
      endAt: null,
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
    expect(runningShift.endAt).toBeNull();
  });

  it("types a trip with mileage claim calculation and fuelCostAmount as recorded-only", () => {
    const trip: Trip = {
      id: "t1",
      occurredAt: "2026-03-02T10:00:00.000Z",
      recordedAt: "2026-03-02T10:15:00.000Z",
      zone: "America/Los_Angeles",
      distance: 50,
      distanceUnit: "mi",
      purpose: "Client appointment",
      isClaimable: true,
      odometerStart: 10000,
      odometerEnd: 10050,
      fuelCostAmount: 800,
      shiftId: null,
      splits: [
        {
          clientId: "c1",
          payerPartyId: "p1",
          distanceShare: 0.5,
          rateApplied: 5850,
          claimAmount: 2925,
        },
        {
          clientId: "c2",
          payerPartyId: "p2",
          distanceShare: 0.5,
          rateApplied: 5850,
          claimAmount: 2925,
        },
      ],
      reimbursementStatus: "unclaimed",
      tags: [],
      customFields: {},
    };

    // Verify rates are snapshotted: claimAmount = distanceShare * rateApplied
    trip.splits.forEach((split) => {
      const expectedClaim = Math.round(split.distanceShare * split.rateApplied);
      expect(split.claimAmount).toBe(expectedClaim);
    });

    // Verify fuelCostAmount is recorded but NOT added to claim total
    const claimTotal = trip.splits.reduce((sum, split) => sum + split.claimAmount, 0);
    expect(claimTotal).toBe(5850); // 2925 + 2925, unaffected by fuelCostAmount
    expect(trip.fuelCostAmount).toBe(800); // recorded but not included in claim

    // Verify trip with shiftId: null is well-formed
    expect(trip.shiftId).toBeNull();
  });
});
