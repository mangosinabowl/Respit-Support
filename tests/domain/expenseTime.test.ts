import { describe, it, expect } from "vitest";
import { expenseAsMinutes, splitByPercent } from "../../src/domain/expenseTime";

describe("expenseAsMinutes", () => {
  it("turns a share into extra time at the rate already agreed", () => {
    expect(expenseAsMinutes(1500, 3000)).toBe(30); // $15.00 at $30/hr
    expect(expenseAsMinutes(3000, 3000)).toBe(60);
    expect(expenseAsMinutes(1000, 3000)).toBe(20);
  });

  it("uses the person's own rate, so the same receipt is worth different time", () => {
    expect(expenseAsMinutes(3000, 6000)).toBe(30); // $30 at $60/hr
    expect(expenseAsMinutes(3000, 1500)).toBe(120); // $30 at $15/hr
  });

  it("rounds up to the minute, never down", () => {
    // 18.18 minutes. Rounding down would hand the payer the fraction for free,
    // and it happens on every conversion that does not land square.
    expect(expenseAsMinutes(1000, 3300)).toBe(19);
    expect(expenseAsMinutes(1, 3000)).toBe(1); // a cent is still a minute
    expect(expenseAsMinutes(3000, 3000)).toBe(60); // exact stays exact
  });

  it("returns nothing when there is no agreed rate to convert against", () => {
    expect(expenseAsMinutes(1500, 0)).toBe(0);
  });
});

describe("splitByPercent", () => {
  it("divides a receipt evenly between three people", () => {
    const parts = splitByPercent(3000, [100 / 3, 100 / 3, 100 / 3]);
    expect(parts).toEqual([1000, 1000, 1000]);
    expect(parts.reduce((t, n) => t + n, 0)).toBe(3000);
  });

  it("rounds every share up, so the worker is never out of pocket", () => {
    // $10 three ways is $3.34 each and $10.02 charged. The worker laid the
    // money out; he does not absorb the fraction for having done the job, and
    // each payer is charged the same amount as the others.
    const parts = splitByPercent(1000, [100 / 3, 100 / 3, 100 / 3]);
    expect(parts).toEqual([334, 334, 334]);
    expect(parts.reduce((t, n) => t + n, 0)).toBe(1002);
  });

  it("honours uneven percentages, still rounding each up", () => {
    // Shares that divide cleanly are unchanged.
    expect(splitByPercent(1000, [50, 30, 20])).toEqual([500, 300, 200]);
    // 999 split evenly is 499.5 each, so both land on 500 and it comes to 1000.
    expect(splitByPercent(999, [50, 50])).toEqual([500, 500]);
  });

  it("refuses shares that do not add up to 100", () => {
    expect(() => splitByPercent(1000, [50, 40])).toThrow(/add up to 100/);
    expect(() => splitByPercent(1000, [60, 60])).toThrow(/add up to 100/);
  });

  it("handles one person taking all of it", () => {
    expect(splitByPercent(1234, [100])).toEqual([1234]);
  });
});
