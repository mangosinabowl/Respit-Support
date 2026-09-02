import { describe, it, expect } from "vitest";
import { newCalc, press, splitPreview, evenShares, type CalcState } from "../../src/ui/calculator";

const type = (keys: string[], start: CalcState = newCalc()) => keys.reduce(press, start);
const shown = (keys: string[]) => type(keys).entry;

describe("plain calculator", () => {
  it("adds, subtracts, multiplies and divides", () => {
    expect(shown(["1", "2", "+", "3", "="])).toBe("15");
    expect(shown(["9", "-", "4", "="])).toBe("5");
    expect(shown(["6", "*", "7", "="])).toBe("42");
    expect(shown(["9", "/", "2", "="])).toBe("4.5");
  });

  it("chains without needing equals between steps", () => {
    const afterSecondPlus = type(["2", "+", "3", "+"]);
    expect(afterSecondPlus.entry).toBe("5");
    expect(press(press(afterSecondPlus, "4"), "=").entry).toBe("9");
  });

  it("says so rather than showing Infinity", () => {
    expect(shown(["8", "/", "0", "="])).toBe("Cannot divide by zero");
  });

  it("handles decimals and the backspace", () => {
    expect(shown(["1", ".", "2", "5", "+", "0", ".", "7", "5", "="])).toBe("2");
    expect(shown(["1", "2", "3", "\u232b"])).toBe("12");
    expect(shown(["5", "\u232b"])).toBe("0");
  });

  it("keeps money arithmetic exact to the cent", () => {
    // 0.1 + 0.2 is the classic floating point trap: it must not show
    // 0.30000000000000004 to someone about to type it into an invoice.
    expect(shown(["0", ".", "1", "+", "0", ".", "2", "="])).toBe("0.3");
  });

  it("percent turns the entry into a fraction, and sign flips", () => {
    expect(shown(["2", "5", "%"])).toBe("0.25");
    expect(shown(["8", "\u00b1"])).toBe("-8");
    expect(shown(["8", "\u00b1", "\u00b1"])).toBe("8");
  });

  it("clear starts again but stays in the same mode", () => {
    const s = press({ ...newCalc(), mode: "split", entry: "99" }, "C");
    expect(s.entry).toBe("0");
    expect(s.mode).toBe("split");
  });
});

describe("split mode", () => {
  it("divides a total by percentage, to the cent", () => {
    const { rows, ok } = splitPreview("30.00", [50, 50]);
    expect(ok).toBe(true);
    expect(rows.map((r) => r.amount)).toEqual([1500, 1500]);
  });

  it("accounts for every cent when it does not divide evenly", () => {
    const { rows } = splitPreview("10.00", evenShares(3));
    expect(rows.reduce((t, r) => t + r.amount, 0)).toBe(1000);
  });

  it("agrees with the split the app itself would record", () => {
    const { rows } = splitPreview("100.00", [33.33, 33.33, 33.34]);
    expect(rows.reduce((t, r) => t + r.amount, 0)).toBe(10000);
  });

  it("refuses to guess when the shares do not add up", () => {
    const { ok, sum } = splitPreview("50.00", [30, 30]);
    expect(ok).toBe(false);
    expect(sum).toBe(60);
  });

  it("evens shares out so they still add up to exactly 100", () => {
    expect(evenShares(4)).toEqual([25, 25, 25, 25]);
    // Three ways is 33.33 each, which is 99.99. The odd hundredth has to land
    // somewhere or the shares cannot be used to split anything.
    expect(evenShares(3)).toEqual([33.34, 33.33, 33.33]);
    for (const n of [1, 2, 3, 6, 7, 9]) {
      expect(evenShares(n).reduce((t, x) => t + x, 0), `${n} ways`).toBeCloseTo(100, 6);
    }
  });
});
