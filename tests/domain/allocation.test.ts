import { describe, it, expect } from "vitest";
import { allocateEvenly, allocateByWeights, type Payee } from "../../src/domain/allocation";

const payees: Payee[] = [
  { clientId: "c1", payerPartyId: "p1" },
  { clientId: "c2", payerPartyId: "p2" },
  { clientId: "c3", payerPartyId: "p2" },
];

describe("allocateEvenly", () => {
  it("splits an exactly divisible amount equally", () => {
    const splits = allocateEvenly(3000, payees);
    expect(splits.map((s) => s.amount)).toEqual([1000, 1000, 1000]);
  });

  it("distributes an indivisible remainder without losing a cent", () => {
    const splits = allocateEvenly(3400, payees);
    expect(splits.map((s) => s.amount)).toEqual([1134, 1133, 1133]);
    expect(splits.reduce((t, s) => t + s.amount, 0)).toBe(3400);
  });

  it("never loses or invents a cent, for any total or party count", () => {
    for (let total = 0; total <= 500; total++) {
      for (let n = 1; n <= 7; n++) {
        const some = Array.from({ length: n }, (_, i) => ({
          clientId: `c${i}`,
          payerPartyId: `p${i}`,
        }));
        const sum = allocateEvenly(total, some).reduce((t, s) => t + s.amount, 0);
        expect(sum).toBe(total);
      }
    }
  });

  it("is deterministic: the same input always gives the same output", () => {
    expect(allocateEvenly(3400, payees)).toEqual(allocateEvenly(3400, payees));
  });

  it("returns no splits when there are no payees", () => {
    expect(allocateEvenly(3400, [])).toEqual([]);
  });

  it("preserves each payee's client and payer", () => {
    const splits = allocateEvenly(3000, payees);
    expect(splits[2]).toEqual({ clientId: "c3", payerPartyId: "p2", amount: 1000 });
  });
});

describe("allocateByWeights", () => {
  it("splits in proportion to the weights", () => {
    const splits = allocateByWeights(4000, payees, [2, 1, 1]);
    expect(splits.map((s) => s.amount)).toEqual([2000, 1000, 1000]);
  });

  it("still sums exactly when weights divide unevenly", () => {
    const splits = allocateByWeights(1000, payees, [1, 1, 1]);
    expect(splits.reduce((t, s) => t + s.amount, 0)).toBe(1000);
  });

  it("falls back to an even split when all weights are zero", () => {
    const splits = allocateByWeights(3000, payees, [0, 0, 0]);
    expect(splits.map((s) => s.amount)).toEqual([1000, 1000, 1000]);
  });

  it("throws when weights do not match payees", () => {
    expect(() => allocateByWeights(3000, payees, [1, 1])).toThrow(/weights/i);
  });
});
