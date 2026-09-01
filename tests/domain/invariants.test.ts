import { describe, it, expect } from "vitest";
import { checkExpense, checkTrip, checkShift, isSubmittable } from "../../src/domain/invariants";
import type { Expense, Trip, Shift } from "../../src/domain/entities";

const base = {
  occurredAt: "2026-03-01T22:00:00.000Z",
  recordedAt: "2026-03-01T22:00:00.000Z",
  zone: "UTC",
  tags: [],
  customFields: {},
};

function expense(over: Partial<Expense> = {}): Expense {
  return {
    ...base,
    id: "e1",
    totalAmount: 3400,
    category: "food",
    description: "Lunch",
    receiptAttachmentIds: ["a1"],
    splits: [
      { clientId: "c1", payerPartyId: "p1", amount: 1700 },
      { clientId: "c2", payerPartyId: "p2", amount: 1700 },
    ],
    reimbursementStatus: "unclaimed",
    ...over,
  } as Expense;
}

describe("checkExpense", () => {
  it("passes when splits sum to the total", () => {
    expect(checkExpense(expense())).toEqual([]);
  });

  it("flags under-allocation with the exact shortfall", () => {
    const v = checkExpense(expense({ splits: [{ clientId: "c1", payerPartyId: "p1", amount: 1700 }] }));
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe("SPLITS_DO_NOT_SUM");
    expect(v[0].message).toBe("$17.00 of this expense is not assigned to anyone.");
  });

  it("flags a one-cent discrepancy", () => {
    const v = checkExpense(expense({ totalAmount: 3400, splits: [{ clientId: "c1", payerPartyId: "p1", amount: 3399 }] }));
    expect(v).toHaveLength(1);
    expect(v[0].code).toBe("SPLITS_DO_NOT_SUM");
  });

  it("flags over-allocation", () => {
    const v = checkExpense(
      expense({
        splits: [
          { clientId: "c1", payerPartyId: "p1", amount: 2000 },
          { clientId: "c2", payerPartyId: "p2", amount: 2000 },
        ],
      }),
    );
    expect(v[0].code).toBe("SPLITS_DO_NOT_SUM");
    expect(v[0].message).toBe("$6.00 more than the receipt is assigned out.");
  });

  it("flags an expense with no splits at all", () => {
    expect(checkExpense(expense({ splits: [] }))[0].code).toBe("NO_SPLITS");
  });

  it("flags a missing receipt", () => {
    const v = checkExpense(expense({ receiptAttachmentIds: [] }));
    expect(v.map((x) => x.code)).toContain("NO_RECEIPT");
  });

  it("flags a negative or zero total", () => {
    expect(checkExpense(expense({ totalAmount: 0, splits: [] })).map((v) => v.code)).toContain(
      "NON_POSITIVE_TOTAL",
    );
  });
});

describe("checkTrip", () => {
  const trip = (over: Partial<Trip> = {}): Trip =>
    ({
      ...base,
      id: "t1",
      distance: 12,
      distanceUnit: "mi",
      purpose: "Park",
      isClaimable: true,
      splits: [{ clientId: "c1", payerPartyId: "p1", distanceShare: 12, rateApplied: 67, claimAmount: 804 }],
      reimbursementStatus: "unclaimed",
      ...over,
    }) as Trip;

  it("passes a well-formed trip", () => {
    expect(checkTrip(trip())).toEqual([]);
  });

  it("flags a claim amount that does not match distance times rate", () => {
    const v = checkTrip(
      trip({ splits: [{ clientId: "c1", payerPartyId: "p1", distanceShare: 12, rateApplied: 67, claimAmount: 999 }] }),
    );
    expect(v[0].code).toBe("CLAIM_MISMATCH");
  });

  it("flags a negative distance share", () => {
    const v = checkTrip(
      trip({ splits: [{ clientId: "c1", payerPartyId: "p1", distanceShare: -12, rateApplied: 67, claimAmount: -804 }] }),
    );
    expect(v.map((x) => x.code)).toContain("NEGATIVE_CLAIM");
  });

  it("flags a negative claim amount", () => {
    const v = checkTrip(
      trip({ splits: [{ clientId: "c1", payerPartyId: "p1", distanceShare: 12, rateApplied: 67, claimAmount: -100 }] }),
    );
    expect(v.map((x) => x.code)).toContain("NEGATIVE_CLAIM");
  });

  it("accepts a zero claim, which largest-remainder splitting can produce honestly", () => {
    const v = checkTrip(
      trip({ splits: [{ clientId: "c1", payerPartyId: "p1", distanceShare: 0, rateApplied: 67, claimAmount: 0 }] }),
    );
    expect(v).toEqual([]);
  });

  it("allows fuel cost to be recorded alongside a mileage claim without adding it", () => {
    const withFuel = trip({ fuelCostAmount: 4500 });
    expect(checkTrip(withFuel)).toEqual([]);
    // The claim is unchanged by the presence of fuel cost — no double claim. Spec §4.6.
    expect(withFuel.splits.reduce((t, s) => t + s.claimAmount, 0)).toBe(804);
  });

  it("skips claim checks on a non-claimable trip", () => {
    expect(checkTrip(trip({ isClaimable: false, splits: [] }))).toEqual([]);
  });

  it("flags a claimable trip with no splits", () => {
    expect(checkTrip(trip({ isClaimable: true, splits: [] }))[0].code).toBe("NO_SPLITS");
  });
});

describe("checkShift", () => {
  const shift = (over: Partial<Shift> = {}): Shift =>
    ({
      ...base,
      id: "s1",
      startAt: "2026-03-01T22:00:00.000Z",
      endAt: "2026-03-02T01:00:00.000Z",
      participants: [
        {
          clientId: "c1",
          payerPartyId: "p1",
          inAt: "2026-03-01T22:00:00.000Z",
          outAt: "2026-03-02T01:00:00.000Z",
          payRate: 3000,
          timeRule: "fullPerPayer",
        },
      ],
      isIncident: false,
      reimbursementStatus: "unclaimed",
      ...over,
    }) as Shift;

  it("passes a well-formed shift", () => {
    expect(checkShift(shift())).toEqual([]);
  });

  it("flags a shift with no participants", () => {
    expect(checkShift(shift({ participants: [] }))[0].code).toBe("NO_PARTICIPANTS");
  });

  it("flags an end before the start", () => {
    const v = checkShift(shift({ endAt: "2026-03-01T20:00:00.000Z" }));
    expect(v.map((x) => x.code)).toContain("END_BEFORE_START");
  });

  it("flags a participant outside the shift window", () => {
    const s = shift();
    s.participants[0].outAt = "2026-03-02T09:00:00.000Z";
    expect(checkShift(s).map((v) => v.code)).toContain("PARTICIPANT_OUTSIDE_SHIFT");
  });

  it("flags a still-running shift as not submittable but not invalid", () => {
    const v = checkShift(shift({ endAt: undefined }));
    expect(v.map((x) => x.code)).toContain("STILL_RUNNING");
  });

  it("flags a still-running shift with endAt: null", () => {
    const v = checkShift(shift({ endAt: null }));
    expect(v.map((x) => x.code)).toContain("STILL_RUNNING");
  });

  it("flags a bad timestamp in startAt", () => {
    const v = checkShift(shift({ startAt: "not-a-date" }));
    expect(v.map((x) => x.code)).toContain("BAD_TIMESTAMP");
  });

  it("flags a bad timestamp in endAt", () => {
    const v = checkShift(shift({ endAt: "not-a-date" }));
    expect(v.map((x) => x.code)).toContain("BAD_TIMESTAMP");
  });

  it("flags a bad timestamp in participant inAt", () => {
    const s = shift();
    s.participants[0].inAt = "not-a-date";
    const v = checkShift(s);
    expect(v.map((x) => x.code)).toContain("BAD_TIMESTAMP");
  });

  it("flags a bad timestamp in participant outAt", () => {
    const s = shift();
    s.participants[0].outAt = "not-a-date";
    const v = checkShift(s);
    expect(v.map((x) => x.code)).toContain("BAD_TIMESTAMP");
  });
});

describe("isSubmittable", () => {
  it("is true when there are no violations", () => {
    expect(isSubmittable([])).toBe(true);
  });

  it("is false when there is any violation", () => {
    expect(isSubmittable([{ code: "NO_SPLITS", message: "x" }])).toBe(false);
  });
});
