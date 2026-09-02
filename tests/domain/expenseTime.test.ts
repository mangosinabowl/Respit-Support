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

  it("rounds to the nearest minute", () => {
    expect(expenseAsMinutes(1000, 3300)).toBe(18); // 18.18 min
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

  it("accounts for every cent when the split does not divide evenly", () => {
    const parts = splitByPercent(1000, [100 / 3, 100 / 3, 100 / 3]);
    expect(parts.reduce((t, n) => t + n, 0)).toBe(1000);
    expect(parts).toEqual([334, 333, 333]);
  });

  it("honours uneven percentages", () => {
    expect(splitByPercent(1000, [50, 30, 20])).toEqual([500, 300, 200]);
    expect(splitByPercent(999, [50, 50]).reduce((t, n) => t + n, 0)).toBe(999);
  });

  it("refuses shares that do not add up to 100", () => {
    expect(() => splitByPercent(1000, [50, 40])).toThrow(/add up to 100/);
    expect(() => splitByPercent(1000, [60, 60])).toThrow(/add up to 100/);
  });

  it("handles one person taking all of it", () => {
    expect(splitByPercent(1234, [100])).toEqual([1234]);
  });
});
