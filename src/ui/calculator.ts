import { splitByPercent } from "../domain/expenseTime";

export interface CalcState {
  mode: "plain" | "split";
  /** What is on the display now. */
  entry: string;
  /** The running value and the operator waiting on it. */
  acc: number | null;
  op: "+" | "-" | "*" | "/" | null;
  /** True once = or an operator has been pressed, so the next digit restarts. */
  fresh: boolean;
  /** Split mode: the amount being divided, and the shares. */
  total: string;
  shares: number[];
}

export const newCalc = (): CalcState => ({
  mode: "plain", entry: "0", acc: null, op: null, fresh: true, total: "", shares: [50, 50],
});

const round2 = (n: number) => Math.round(n * 100) / 100;

function apply(a: number, b: number, op: CalcState["op"]): number {
  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "*") return a * b;
  if (op === "/") return b === 0 ? NaN : a / b;
  return b;
}

/**
 * One key press. Kept as a pure function over the state so the behaviour can be
 * tested without a browser - a calculator that is wrong is worse than no
 * calculator, because its answers get typed into invoices.
 */
export function press(s: CalcState, key: string): CalcState {
  const n = { ...s };

  if (key === "C") return { ...newCalc(), mode: s.mode, total: s.total, shares: s.shares };
  if (key === "±") { n.entry = n.entry.startsWith("-") ? n.entry.slice(1) : `-${n.entry}`; return n; }
  if (key === "%") { n.entry = String(round2(Number(n.entry) / 100)); n.fresh = true; return n; }
  if (key === "⌫") {
    n.entry = n.entry.length > 1 ? n.entry.slice(0, -1) : "0";
    if (n.entry === "-") n.entry = "0";
    return n;
  }

  if (/^[0-9]$/.test(key)) {
    n.entry = n.fresh || n.entry === "0" ? key : n.entry + key;
    n.fresh = false;
    return n;
  }
  if (key === ".") {
    if (n.fresh) { n.entry = "0."; n.fresh = false; return n; }
    if (!n.entry.includes(".")) n.entry += ".";
    return n;
  }

  if (["+", "-", "*", "/"].includes(key)) {
    const value = Number(n.entry);
    // Chaining: 2 + 3 + shows 5 before taking the next number.
    n.acc = n.acc === null || n.op === null ? value : round2(apply(n.acc, value, n.op));
    n.entry = String(n.acc);
    n.op = key as CalcState["op"];
    n.fresh = true;
    return n;
  }

  if (key === "=") {
    if (n.op === null || n.acc === null) { n.fresh = true; return n; }
    const value = apply(n.acc, Number(n.entry), n.op);
    n.entry = Number.isFinite(value) ? String(round2(value)) : "Cannot divide by zero";
    n.acc = null;
    n.op = null;
    n.fresh = true;
    return n;
  }
  return n;
}

export interface SplitRow { percent: number; amount: number }

/**
 * Splits an amount by percentage, using the same apportionment the rest of the
 * app uses. If this rounded differently from the real split, it would hand the
 * worker figures that disagree with what the app records a moment later.
 */
export function splitPreview(total: string, shares: number[]): { rows: SplitRow[]; totalCents: number; sum: number; ok: boolean } {
  const totalCents = Math.round((Number(total) || 0) * 100);
  const sum = round2(shares.reduce((t, p) => t + p, 0));
  const ok = Math.abs(sum - 100) < 0.05 && shares.length > 0;
  if (!ok || !totalCents) {
    return { rows: shares.map((percent) => ({ percent, amount: 0 })), totalCents, sum, ok };
  }
  // Nudge the last share so the total is exactly 100: the display tolerates a
  // hundredth out, the apportionment does not, and it should not throw at
  // someone mid-calculation.
  const exact = [...shares];
  exact[exact.length - 1] = round2(exact[exact.length - 1] + (100 - sum));
  const parts = splitByPercent(totalCents, exact);
  return { rows: shares.map((percent, i) => ({ percent, amount: parts[i] })), totalCents, sum, ok };
}

/**
 * Even shares that still add up to exactly 100.
 *
 * Three ways rounds to 33.33 each, which is 99.99 - close enough to look right
 * and not close enough to split by, so the odd hundredth goes to the first.
 */
export function evenShares(count: number): number[] {
  if (count < 1) return [];
  const each = round2(100 / count);
  const shares = Array.from({ length: count }, () => each);
  shares[0] = round2(shares[0] + (100 - each * count));
  return shares;
}
