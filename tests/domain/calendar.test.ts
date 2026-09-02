import { describe, it, expect } from "vitest";
import { spanFor, step, daysIn, monthsIn, inSpan, dayKey } from "../../src/domain/calendar";

describe("dayKey", () => {
  it("files an instant under the day it was lived, not the UTC day", () => {
    // 9pm on 1 September in Vancouver is already 2 September in UTC. Grouping
    // on the raw string would move that shift into the next week, and so into
    // a different invoice.
    const evening = "2026-09-02T04:00:00.000Z";
    expect(dayKey(evening, "America/Vancouver")).toBe("2026-09-01");
    expect(dayKey(evening, "UTC")).toBe("2026-09-02");
  });
});

describe("spanFor", () => {
  it("a day is itself", () => {
    const s = spanFor("2026-09-02", "day");
    expect([s.from, s.to]).toEqual(["2026-09-02", "2026-09-02"]);
  });

  it("a week runs Monday to Sunday", () => {
    // 2 September 2026 is a Wednesday.
    const s = spanFor("2026-09-02", "week");
    expect([s.from, s.to]).toEqual(["2026-08-31", "2026-09-06"]);
    expect(daysIn(s)).toHaveLength(7);
  });

  it("bi-weekly is this week and the one before, not the one after", () => {
    // 2 September 2026 is a Wednesday, so this week starts Monday 31 August.
    const s = spanFor("2026-09-02", "fortnight");
    expect([s.from, s.to]).toEqual(["2026-08-24", "2026-09-06"]);
    expect(daysIn(s)).toHaveLength(14);
  });

  it("a month covers the whole month, however long it is", () => {
    expect(spanFor("2026-02-10", "month")).toMatchObject({ from: "2026-02-01", to: "2026-02-28" });
    expect(spanFor("2024-02-10", "month")).toMatchObject({ from: "2024-02-01", to: "2024-02-29" });
    expect(spanFor("2026-12-31", "month")).toMatchObject({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("three months is this month and the two before it", () => {
    const s = spanFor("2026-09-02", "threeMonths");
    expect([s.from, s.to]).toEqual(["2026-07-01", "2026-09-30"]);
    expect(monthsIn(s).map((m) => m.label)).toEqual(["July", "August", "September"]);
  });

  it("three months reaches back across a year boundary", () => {
    const s = spanFor("2026-01-15", "threeMonths");
    expect([s.from, s.to]).toEqual(["2025-11-01", "2026-01-31"]);
    expect(monthsIn(s).map((m) => m.label)).toEqual(["November", "December", "January"]);
  });

  it("a year is the whole year", () => {
    const s = spanFor("2026-06-15", "year");
    expect([s.from, s.to]).toEqual(["2026-01-01", "2026-12-31"]);
    expect(monthsIn(s)).toHaveLength(12);
  });
});

describe("step", () => {
  it("moves by whole spans and back again", () => {
    for (const grain of ["day", "week", "fortnight", "month", "threeMonths", "year"] as const) {
      const there = step("2026-09-02", grain, 1);
      const back = step(there, grain, -1);
      expect(spanFor(back, grain).from, grain).toBe(spanFor("2026-09-02", grain).from);
    }
  });

  it("crosses a year boundary without losing its place", () => {
    expect(spanFor(step("2026-12-15", "month", 1), "month").from).toBe("2027-01-01");
    expect(spanFor(step("2026-01-15", "month", -1), "month").from).toBe("2025-12-01");
  });

  it("steps a week across the end of a month", () => {
    expect(spanFor(step("2026-08-31", "week", 1), "week").from).toBe("2026-09-07");
  });
});

describe("inSpan", () => {
  it("includes both ends", () => {
    const s = spanFor("2026-09-02", "week");
    expect(inSpan("2026-08-31", s)).toBe(true);
    expect(inSpan("2026-09-06", s)).toBe(true);
    expect(inSpan("2026-08-30", s)).toBe(false);
    expect(inSpan("2026-09-07", s)).toBe(false);
  });
});
