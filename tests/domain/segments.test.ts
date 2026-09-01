import { describe, it, expect } from "vitest";
import { segmentsFor } from "../../src/domain/segments";
import type { Participant } from "../../src/domain/entities";

function p(clientId: string, inAt: string, outAt: string): Participant {
  return {
    clientId,
    payerPartyId: `payer-${clientId}`,
    inAt,
    outAt,
    payRate: 2500,
    timeRule: "fullPerPayer",
  };
}

const T = (h: number) => `2026-03-01T${String(h).padStart(2, "0")}:00:00.000Z`;

describe("segmentsFor", () => {
  it("returns one segment for a single participant", () => {
    const segs = segmentsFor([p("c1", T(15), T(18))]);
    expect(segs).toEqual([{ from: T(15), to: T(18), clientIds: ["c1"], minutes: 180 }]);
  });

  it("splits a staggered shift into 1:1, 1:2, 1:1", () => {
    const segs = segmentsFor([p("c1", T(15), T(18)), p("c2", T(16), T(17))]);
    expect(segs).toEqual([
      { from: T(15), to: T(16), clientIds: ["c1"], minutes: 60 },
      { from: T(16), to: T(17), clientIds: ["c1", "c2"], minutes: 60 },
      { from: T(17), to: T(18), clientIds: ["c1"], minutes: 60 },
    ]);
  });

  it("handles identical times as one shared segment", () => {
    const segs = segmentsFor([p("c1", T(15), T(18)), p("c2", T(15), T(18))]);
    expect(segs).toHaveLength(1);
    expect(segs[0].clientIds).toEqual(["c1", "c2"]);
  });

  it("omits gaps when participants do not overlap at all", () => {
    const segs = segmentsFor([p("c1", T(15), T(16)), p("c2", T(17), T(18))]);
    expect(segs).toEqual([
      { from: T(15), to: T(16), clientIds: ["c1"], minutes: 60 },
      { from: T(17), to: T(18), clientIds: ["c2"], minutes: 60 },
    ]);
  });

  it("returns no segments for no participants", () => {
    expect(segmentsFor([])).toEqual([]);
  });

  it("ignores a participant whose out time equals their in time", () => {
    const segs = segmentsFor([p("c1", T(15), T(18)), p("c2", T(16), T(16))]);
    expect(segs).toEqual([{ from: T(15), to: T(18), clientIds: ["c1"], minutes: 180 }]);
  });

  it("sorts client ids within a segment for deterministic output", () => {
    const segs = segmentsFor([p("z1", T(15), T(18)), p("a1", T(15), T(18))]);
    expect(segs[0].clientIds).toEqual(["a1", "z1"]);
  });
});
