import { describe, it, expect } from "vitest";
import { newId, nowInstant, localZone } from "../../src/domain/primitives";

describe("primitives", () => {
  it("generates unique ids", () => {
    const a = newId();
    const b = newId();
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThan(20);
  });

  it("produces a UTC ISO instant ending in Z", () => {
    const t = nowInstant();
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("produces an IANA zone name containing a slash or UTC", () => {
    const z = localZone();
    expect(z === "UTC" || z.includes("/")).toBe(true);
  });
});
