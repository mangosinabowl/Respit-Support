/**
 * A standalone calculator. It does arithmetic, correctly, and nothing else.
 *
 * It deliberately shares NO code with the app's money rules. The app rounds up
 * in the worker's favour because that is a billing policy; a calculator that
 * did the same would be lying about what ten divided by three is. Nothing here
 * reads or writes any record.
 */

export interface CalcState {
  mode: "plain" | "split";
  entry: string;
  acc: number | null;
  op: "+" | "-" | "*" | "/" | null;
  fresh: boolean;
  total: string;
  shares: number[];
}

export const newCalc = (): CalcState => ({
  mode: "plain", entry: "0", acc: null, op: null, fresh: true, total: "", shares: [50, 50],
});

/**
 * Formats a number for the display without falsifying it.
 *
 * Binary floating point cannot hold 0.1 exactly, so 0.1 + 0.2 comes out as
 * 0.30000000000000004. Trimming to 12 significant figures removes that
 * artefact and leaves every digit the user is entitled to see: a third still
 * shows as 0.333333333333, not 0.33.
 */
export function show(n: number): string {
  if (!Number.isFinite(n)) return "Cannot divide by zero";
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return String(n);
  const trimmed = Number(n.toPrecision(12));
  return String(trimmed);
}

const calc = (a: number, b: number, op: CalcState["op"]): number => {
  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "*") return a * b;
  if (op === "/") return a / b;
  return b;
};

/** One key press, as a pure function so the arithmetic can be tested directly. */
export function press(s: CalcState, key: string): CalcState {
  const n = { ...s };
  const isError = n.entry.startsWith("Cannot");

  if (key === "C") return { ...newCalc(), mode: s.mode, total: s.total, shares: s.shares };
  if (isError && key !== "C") return n; // nothing but clear escapes an error

  if (key === "\u00b1") { n.entry = n.entry.startsWith("-") ? n.entry.slice(1) : `-${n.entry}`; return n; }
  if (key === "%") { n.entry = show(Number(n.entry) / 100); n.fresh = true; return n; }
  if (key === "\u232b") {
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
    n.acc = n.acc === null || n.op === null ? value : calc(n.acc, value, n.op);
    n.entry = show(n.acc);
    n.op = key as CalcState["op"];
    n.fresh = true;
    return n;
  }
  if (key === "=") {
    if (n.op === null || n.acc === null) { n.fresh = true; return n; }
    n.entry = show(calc(n.acc, Number(n.entry), n.op));
    n.acc = null;
    n.op = null;
    n.fresh = true;
    return n;
  }
  return n;
}

export interface SplitRow {
  percent: number;
  /** The arithmetic: exact, unrounded. */
  amount: number;
  /** What the app would charge for that share, in cents, rounded up per its
   *  billing rule. Shown alongside so the two are never confused. */
  charged: number;
}

/**
 * Divides a number by percentages, exactly.
 *
 * No rounding to the cent and no rounding up: ten divided three ways is
 * 3.333... three times, and the parts add back to exactly ten. This is a
 * calculator, not the invoice.
 */
export function splitPreview(total: string, shares: number[]): {
  rows: SplitRow[]; totalValue: number; sum: number; ok: boolean;
  /** Exact arithmetic total, and what the app would actually charge. */
  exactTotal: number; chargedTotal: number;
} {
  const totalValue = Number(total) || 0;
  const sum = Number(shares.reduce((t, p) => t + p, 0).toPrecision(12));
  // Loose enough for a third at full precision, tight enough that a typo does
  // not slip through.
  const ok = Math.abs(sum - 100) < 1e-6 && shares.length > 0;
  const cents = Math.round(totalValue * 100);

  const rows = shares.map((percent) => ({
    percent,
    amount: (totalValue * percent) / 100,
    // The app's rule, applied to the same share: rounded UP to the cent, which
    // is why this column can come to more than the amount being divided.
    charged: ok ? Math.ceil((cents * percent) / 100) : 0,
  }));

  return {
    rows, totalValue, sum, ok,
    exactTotal: rows.reduce((t, r) => t + r.amount, 0),
    chargedTotal: rows.reduce((t, r) => t + r.charged, 0),
  };
}

/**
 * Even shares, at full precision.
 *
 * Rounding these to two decimals first (33.34 / 33.33 / 33.33) made the split
 * unequal: on $30, which divides perfectly, the first person was charged a cent
 * more than the other two for no reason. A third is a third.
 */
export function evenShares(count: number): number[] {
  if (count < 1) return [];
  return Array.from({ length: count }, () => 100 / count);
}
