import { describe, it, expect } from "vitest";
import { newCalc, press, splitPreview, evenShares, show, type CalcState } from "../../src/ui/calculator";

const type = (keys: string[], start: CalcState = newCalc()) => keys.reduce(press, start);
const on = (keys: string[]) => type(keys).entry;

describe("it does arithmetic, correctly", () => {
  it("adds, subtracts, multiplies and divides", () => {
    expect(on(["1", "2", "+", "3", "="])).toBe("15");
    expect(on(["9", "-", "4", "="])).toBe("5");
    expect(on(["6", "*", "7", "="])).toBe("42");
    expect(on(["9", "/", "2", "="])).toBe("4.5");
  });

  it("gives a third as a third, not as two decimal places", () => {
    // The app rounds money to the cent. A calculator that did the same would be
    // answering a different question from the one asked.
    expect(on(["1", "0", "/", "3", "="])).toBe("3.33333333333");
    expect(on(["1", "/", "3", "="])).toBe("0.333333333333");
    expect(on(["2", "/", "3", "="])).toBe("0.666666666667");
  });

  it("does not show floating point noise", () => {
    expect(on(["0", ".", "1", "+", "0", ".", "2", "="])).toBe("0.3");
    expect(on(["1", ".", "1", "*", "3", "="])).toBe("3.3");
    expect(on(["4", ".", "3", "5", "-", "4", "="])).toBe("0.35");
  });

  it("chains without equals between steps", () => {
    const s = type(["2", "+", "3", "+"]);
    expect(s.entry).toBe("5");
    expect(press(press(s, "4"), "=").entry).toBe("9");
  });

  it("says so rather than showing Infinity, and stays stuck until cleared", () => {
    expect(on(["8", "/", "0", "="])).toBe("Cannot divide by zero");
    // Pressing digits on an error must not build a number onto the message.
    expect(on(["8", "/", "0", "=", "5"])).toBe("Cannot divide by zero");
    expect(on(["8", "/", "0", "=", "C"])).toBe("0");
  });

  it("handles decimals, backspace, percent and sign", () => {
    expect(on(["1", ".", "2", "5", "+", "0", ".", "7", "5", "="])).toBe("2");
    expect(on(["1", "2", "3", "\u232b"])).toBe("12");
    expect(on(["5", "\u232b"])).toBe("0");
    expect(on(["2", "5", "%"])).toBe("0.25");
    expect(on(["8", "\u00b1"])).toBe("-8");
    expect(on(["8", "\u00b1", "\u00b1"])).toBe("8");
  });

  it("keeps whole numbers whole", () => {
    expect(show(42)).toBe("42");
    expect(show(-7)).toBe("-7");
    expect(show(0)).toBe("0");
  });

  it("clear starts again but stays in the same mode", () => {
    const s = press({ ...newCalc(), mode: "split", entry: "99" }, "C");
    expect(s.entry).toBe("0");
    expect(s.mode).toBe("split");
  });
});

describe("splitting divides exactly", () => {
  it("splits ten three ways as thirds, adding back to ten", () => {
    // Not 3.34 each. That is what the invoice charges; it is not what the
    // division is.
    const { rows, ok } = splitPreview("10", evenShares(3));
    expect(ok).toBe(true);
    expect(rows.reduce((t, r) => t + r.amount, 0)).toBeCloseTo(10, 10);
    expect(rows[1].amount).toBeCloseTo(10 / 3, 10);
  });

  it("handles clean divisions cleanly", () => {
    expect(splitPreview("30", [50, 50]).rows.map((r) => r.amount)).toEqual([15, 15]);
    expect(splitPreview("100", [25, 25, 25, 25]).rows.map((r) => r.amount)).toEqual([25, 25, 25, 25]);
  });

  it("honours uneven percentages", () => {
    const { rows } = splitPreview("200", [10, 65, 25]);
    expect(rows.map((r) => r.amount)).toEqual([20, 130, 50]);
  });

  it("refuses to guess when the shares do not add up", () => {
    expect(splitPreview("50", [30, 30]).ok).toBe(false);
    expect(splitPreview("50", [30, 30]).sum).toBe(60);
  });

  it("gives both answers: the exact one and what the app would charge", () => {
    const { rows, exactTotal, chargedTotal } = splitPreview("10", evenShares(3));
    // The arithmetic: thirds, adding back to exactly ten.
    expect(rows[0].amount).toBeCloseTo(10 / 3, 10);
    expect(exactTotal).toBeCloseTo(10, 10);
    // The billing rule: each share rounded up to the cent, so $10.02 charged.
    expect(rows.map((r) => r.charged)).toEqual([334, 334, 334]);
    expect(chargedTotal).toBe(1002);
  });

  it("the two answers agree whenever the division is clean", () => {
    const { rows, exactTotal, chargedTotal } = splitPreview("30", evenShares(3));
    expect(rows.map((r) => r.charged)).toEqual([1000, 1000, 1000]);
    expect(chargedTotal).toBe(Math.round(exactTotal * 100));
  });

  it("evens shares out equally, not approximately", () => {
    expect(evenShares(4)).toEqual([25, 25, 25, 25]);
    for (const n of [1, 2, 3, 6, 7, 9, 11]) {
      const shares = evenShares(n);
      // Every share identical: rounding them to two decimals first made one
      // person pay a cent more even when the amount divided perfectly.
      expect(new Set(shares).size, `${n} ways`).toBe(1);
      expect(shares.reduce((t, x) => t + x, 0), `${n} ways`).toBeCloseTo(100, 9);
    }
  });
});
