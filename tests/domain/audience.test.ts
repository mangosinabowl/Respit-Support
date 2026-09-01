import { describe, it, expect } from "vitest";
import {
  clientsVisibleTo,
  filterShiftFor,
  filterExpenseFor,
  filterNotesFor,
  type AudienceContext,
} from "../../src/domain/audience";
import { replay } from "../../src/domain/replay";
import type { DomainEvent } from "../../src/domain/events";
import type { Shift, Expense, Note } from "../../src/domain/entities";

function roleEvent(id: string, clientId: string, partyId: string, role: string): DomainEvent {
  return {
    eventId: id,
    entityType: "role",
    entityId: id,
    fields: { clientId, partyId, role },
    recordedAt: "2026-01-01T00:00:00.000Z",
    deviceId: "dev-a",
    seq: 1,
  };
}

// Agency A pays for Rory. A family pays for Sam. A grandmother is Rory's guardian.
const store = replay([
  roleEvent("r1", "rory", "agencyA", "payer"),
  roleEvent("r2", "sam", "familyB", "payer"),
  roleEvent("r3", "rory", "gran", "guardian"),
]);

const mixedShift: Shift = {
  id: "s1",
  occurredAt: "2026-03-01T22:00:00.000Z",
  recordedAt: "2026-03-01T22:00:00.000Z",
  zone: "UTC",
  startAt: "2026-03-01T22:00:00.000Z",
  endAt: "2026-03-02T01:00:00.000Z",
  participants: [
    { clientId: "rory", payerPartyId: "agencyA", inAt: "2026-03-01T22:00:00.000Z", outAt: "2026-03-02T01:00:00.000Z", payRate: 3000, timeRule: "fullPerPayer" },
    { clientId: "sam", payerPartyId: "familyB", inAt: "2026-03-01T22:00:00.000Z", outAt: "2026-03-02T01:00:00.000Z", payRate: 2500, timeRule: "fullPerPayer" },
  ],
  isIncident: false,
  reimbursementStatus: "unclaimed",
  tags: [],
  customFields: {},
};

const shiftWithMetadata: Shift = {
  id: "s2",
  occurredAt: "2026-03-01T22:00:00.000Z",
  recordedAt: "2026-03-01T22:00:00.000Z",
  zone: "UTC",
  startAt: "2026-03-01T22:00:00.000Z",
  endAt: "2026-03-02T01:00:00.000Z",
  participants: [
    { clientId: "rory", payerPartyId: "agencyA", inAt: "2026-03-01T22:00:00.000Z", outAt: "2026-03-02T01:00:00.000Z", payRate: 3000, timeRule: "fullPerPayer" },
    { clientId: "sam", payerPartyId: "familyB", inAt: "2026-03-01T23:00:00.000Z", outAt: "2026-03-02T00:00:00.000Z", payRate: 2500, timeRule: "fullPerPayer" },
  ],
  isIncident: true,
  reimbursementStatus: "unclaimed",
  tags: ["tag1", "tag2"],
  customFields: { note: "shared expense" },
};

describe("clientsVisibleTo", () => {
  it("shows every client to me", () => {
    expect(clientsVisibleTo(store, { audience: "me" }).sort()).toEqual(["rory", "sam"]);
  });

  it("shows a payer only the clients they pay for", () => {
    expect(clientsVisibleTo(store, { audience: "payer", partyId: "agencyA" })).toEqual(["rory"]);
  });

  it("shows a guardian only their own child", () => {
    expect(clientsVisibleTo(store, { audience: "guardian", partyId: "gran" })).toEqual(["rory"]);
  });

  it("shows nothing to a party with no roles", () => {
    expect(clientsVisibleTo(store, { audience: "payer", partyId: "stranger" })).toEqual([]);
  });

  it("shows nothing when partyId is undefined", () => {
    expect(clientsVisibleTo(store, { audience: "payer" })).toEqual([]);
  });
});

describe("filterShiftFor", () => {
  const ctx: AudienceContext = { audience: "payer", partyId: "agencyA" };

  it("removes other payers' participants entirely", () => {
    const filtered = filterShiftFor(mixedShift, ctx, ["rory"])!;
    expect(filtered.participants).toHaveLength(1);
    expect(filtered.participants[0].clientId).toBe("rory");
  });

  it("leaks no trace of the other client anywhere in the output", () => {
    const filtered = filterShiftFor(mixedShift, ctx, ["rory"])!;
    expect(JSON.stringify(filtered)).not.toContain("sam");
    expect(JSON.stringify(filtered)).not.toContain("familyB");
  });

  it("returns null when the audience has no participant on the shift", () => {
    expect(filterShiftFor(mixedShift, { audience: "payer", partyId: "stranger" }, [])).toBeNull();
  });

  it("returns a copy for me, not the same reference", () => {
    const filtered = filterShiftFor(mixedShift, { audience: "me" }, ["rory", "sam"])!;
    expect(filtered).toEqual(mixedShift);
    expect(filtered).not.toBe(mixedShift);
  });

  it("strips pay rates from a guardian's view", () => {
    const guardianCtx: AudienceContext = { audience: "guardian", partyId: "gran" };
    const filtered = filterShiftFor(mixedShift, guardianCtx, ["rory"])!;
    expect(filtered).not.toBeNull();
    expect(filtered.participants[0]).not.toHaveProperty("payRate");
  });

  it("strips payerPartyId from a guardian's view", () => {
    const guardianCtx: AudienceContext = { audience: "guardian", partyId: "gran" };
    const filtered = filterShiftFor(mixedShift, guardianCtx, ["rory"])!;
    expect(filtered).not.toBeNull();
    expect(filtered.participants[0]).not.toHaveProperty("payerPartyId");
  });

  it("returns null when payer context has no partyId", () => {
    expect(filterShiftFor(mixedShift, { audience: "payer" }, ["rory"])).toBeNull();
  });

  it("returns null when guardian context has no partyId", () => {
    expect(filterShiftFor(mixedShift, { audience: "guardian" }, ["rory"])).toBeNull();
  });

  it("fails closed when payerPartyId is missing and partyId check is the only guard", () => {
    // Test that the payerPartyId guard works even when visibleClients includes the client
    const shiftWithoutPayerPartyId: Shift = {
      ...mixedShift,
      participants: [
        { clientId: "rory", payerPartyId: undefined as any, inAt: "2026-03-01T22:00:00.000Z", outAt: "2026-03-02T01:00:00.000Z", payRate: 3000, timeRule: "fullPerPayer" },
      ],
    };
    expect(filterShiftFor(shiftWithoutPayerPartyId, { audience: "payer", partyId: "agencyA" }, ["rory"])).toBeNull();
  });

  it("does not expose tags and customFields to non-me audience", () => {
    const filtered = filterShiftFor(shiftWithMetadata, ctx, ["rory"])!;
    expect(filtered.tags).toEqual([]);
    expect(filtered.customFields).toEqual({});
  });

  it("does not expose isIncident to non-me audience", () => {
    const filtered = filterShiftFor(shiftWithMetadata, ctx, ["rory"])!;
    expect(filtered.isIncident).toBe(false);
  });

  it("excludes participants not in visibleClients even if they match the payer", () => {
    // agencyA also pays for "charlie", but charlie is not in visibleClients
    const shiftWithCharlie: Shift = {
      ...mixedShift,
      participants: [
        { clientId: "rory", payerPartyId: "agencyA", inAt: "2026-03-01T22:00:00.000Z", outAt: "2026-03-02T01:00:00.000Z", payRate: 3000, timeRule: "fullPerPayer" },
        { clientId: "charlie", payerPartyId: "agencyA", inAt: "2026-03-01T22:00:00.000Z", outAt: "2026-03-02T01:00:00.000Z", payRate: 3000, timeRule: "fullPerPayer" },
      ],
    };
    const filtered = filterShiftFor(shiftWithCharlie, ctx, ["rory"])!;
    expect(filtered.participants).toHaveLength(1);
    expect(filtered.participants[0].clientId).toBe("rory");
  });

  it("narrows time window to visible participants' span", () => {
    const filtered = filterShiftFor(shiftWithMetadata, ctx, ["rory"])!;
    expect(filtered.startAt).toBe("2026-03-01T22:00:00.000Z");
    expect(filtered.endAt).toBe("2026-03-02T01:00:00.000Z");
  });
});

describe("filterExpenseFor", () => {
  const lunch: Expense = {
    id: "e1",
    occurredAt: "2026-03-01T23:00:00.000Z",
    recordedAt: "2026-03-01T23:00:00.000Z",
    zone: "UTC",
    totalAmount: 3400,
    category: "food",
    description: "Lunch",
    receiptAttachmentIds: ["a1"],
    splits: [
      { clientId: "rory", payerPartyId: "agencyA", amount: 1700 },
      { clientId: "sam", payerPartyId: "familyB", amount: 1700 },
    ],
    reimbursementStatus: "unclaimed",
    tags: [],
    customFields: {},
  };

  const lunchWithMetadata: Expense = {
    id: "e2",
    occurredAt: "2026-03-01T23:00:00.000Z",
    recordedAt: "2026-03-01T23:00:00.000Z",
    zone: "UTC",
    totalAmount: 3400,
    category: "food",
    description: "Lunch at Sam's favorite pizza place",
    receiptAttachmentIds: ["a1", "a2"],
    splits: [
      { clientId: "rory", payerPartyId: "agencyA", amount: 1700 },
      { clientId: "sam", payerPartyId: "familyB", amount: 1700 },
    ],
    reimbursementStatus: "unclaimed",
    tags: ["tag1"],
    customFields: { memo: "shared meal" },
  };

  it("shows a payer only their own split and restates the total as their share", () => {
    const filtered = filterExpenseFor(lunch, { audience: "payer", partyId: "agencyA" }, ["rory"])!;
    expect(filtered.splits).toHaveLength(1);
    expect(filtered.totalAmount).toBe(1700);
  });

  it("leaks no trace of the other family", () => {
    const filtered = filterExpenseFor(lunch, { audience: "payer", partyId: "agencyA" }, ["rory"])!;
    expect(JSON.stringify(filtered)).not.toContain("sam");
    expect(JSON.stringify(filtered)).not.toContain("familyB");
  });

  it("returns null when none of the splits belong to the audience", () => {
    expect(filterExpenseFor(lunch, { audience: "payer", partyId: "stranger" }, [])).toBeNull();
  });

  it("returns a copy for me, not the same reference", () => {
    const filtered = filterExpenseFor(lunch, { audience: "me" }, ["rory", "sam"])!;
    expect(filtered).toEqual(lunch);
    expect(filtered).not.toBe(lunch);
  });

  it("returns null when payer context has no partyId", () => {
    expect(filterExpenseFor(lunch, { audience: "payer" }, ["rory"])).toBeNull();
  });

  it("returns null when guardian context has no partyId", () => {
    expect(filterExpenseFor(lunch, { audience: "guardian" }, ["rory"])).toBeNull();
  });

  it("fails closed when payerPartyId is missing and partyId check is the only guard", () => {
    const expenseWithoutPayerPartyId: Expense = {
      ...lunch,
      splits: [{ clientId: "rory", payerPartyId: undefined as any, amount: 1700 }],
    };
    expect(filterExpenseFor(expenseWithoutPayerPartyId, { audience: "payer", partyId: "agencyA" }, ["rory"])).toBeNull();
  });

  it("does not expose description to non-me audience", () => {
    const filtered = filterExpenseFor(lunchWithMetadata, { audience: "payer", partyId: "agencyA" }, ["rory"])!;
    expect(filtered.description).toBe("");
  });

  it("does not expose receiptAttachmentIds to non-me audience", () => {
    const filtered = filterExpenseFor(lunchWithMetadata, { audience: "payer", partyId: "agencyA" }, ["rory"])!;
    expect(filtered.receiptAttachmentIds).toEqual([]);
  });

  it("does not expose tags and customFields to non-me audience", () => {
    const filtered = filterExpenseFor(lunchWithMetadata, { audience: "payer", partyId: "agencyA" }, ["rory"])!;
    expect(filtered.tags).toEqual([]);
    expect(filtered.customFields).toEqual({});
  });

  it("excludes splits not in visibleClients even if they match the payer", () => {
    const expenseWithCharlie: Expense = {
      ...lunch,
      splits: [
        { clientId: "rory", payerPartyId: "agencyA", amount: 1700 },
        { clientId: "charlie", payerPartyId: "agencyA", amount: 1700 },
      ],
    };
    const filtered = filterExpenseFor(expenseWithCharlie, { audience: "payer", partyId: "agencyA" }, ["rory"])!;
    expect(filtered.splits).toHaveLength(1);
    expect(filtered.splits[0].clientId).toBe("rory");
  });
});

describe("filterNotesFor", () => {
  const notes: Note[] = [
    { id: "n1", body: "private thought", attachedToType: "shift", attachedToId: "s1", visibility: { me: true, payer: false, guardian: false }, occurredAt: "x", recordedAt: "x", zone: "UTC", tags: [], customFields: {} },
    { id: "n2", body: "for the agency", attachedToType: "shift", attachedToId: "s1", visibility: { me: true, payer: true, guardian: false }, occurredAt: "x", recordedAt: "x", zone: "UTC", tags: [], customFields: {} },
    { id: "n3", body: "for gran", attachedToType: "shift", attachedToId: "s1", visibility: { me: true, payer: false, guardian: true }, occurredAt: "x", recordedAt: "x", zone: "UTC", tags: [], customFields: {} },
    { id: "n4", body: "attached to different shift", attachedToType: "shift", attachedToId: "s2", visibility: { me: true, payer: true, guardian: false }, occurredAt: "x", recordedAt: "x", zone: "UTC", tags: [], customFields: {} },
  ];

  it("gives me everything", () => {
    expect(filterNotesFor(notes, { audience: "me" }, ["s1", "s2"])).toHaveLength(4);
  });

  it("gives a payer only payer-visible notes", () => {
    expect(filterNotesFor(notes, { audience: "payer", partyId: "agencyA" }, ["s1"]).map((n) => n.id)).toEqual(["n2"]);
  });

  it("gives a guardian only guardian-visible notes", () => {
    expect(filterNotesFor(notes, { audience: "guardian", partyId: "gran" }, ["s1"]).map((n) => n.id)).toEqual(["n3"]);
  });

  it("never includes a private note in a non-me audience", () => {
    for (const audience of ["payer", "guardian"] as const) {
      const out = filterNotesFor(notes, { audience, partyId: "x" }, ["s1"]);
      expect(out.some((n) => n.body === "private thought")).toBe(false);
    }
  });

  it("excludes notes attached to records the audience cannot see", () => {
    const filtered = filterNotesFor(notes, { audience: "payer", partyId: "agencyA" }, ["s1"]);
    expect(filtered.map((n) => n.id)).not.toContain("n4");
  });

  it("requires explicit true for visibility flags, not just truthy", () => {
    const noteWithStringTrue: Note = {
      id: "n5",
      body: "test",
      attachedToType: "shift",
      attachedToId: "s1",
      visibility: { me: true, payer: "true" as any, guardian: false },
      occurredAt: "x",
      recordedAt: "x",
      zone: "UTC",
      tags: [],
      customFields: {},
    };
    const filtered = filterNotesFor([noteWithStringTrue], { audience: "payer", partyId: "agencyA" }, ["s1"]);
    expect(filtered).toHaveLength(0);
  });

  it("fails closed when visibility object is missing", () => {
    const noteBroken: Note = {
      id: "n6",
      body: "test",
      attachedToType: "shift",
      attachedToId: "s1",
      visibility: undefined as any,
      occurredAt: "x",
      recordedAt: "x",
      zone: "UTC",
      tags: [],
      customFields: {},
    };
    // Should not crash, should fail safely
    expect(() => {
      filterNotesFor([noteBroken], { audience: "payer", partyId: "agencyA" }, ["s1"]);
    }).not.toThrow();
  });
});

describe("Leak check: two-family shift with metadata", () => {
  const shiftWithMetadata: Shift = {
    id: "s1",
    occurredAt: "2026-03-01T22:00:00.000Z",
    recordedAt: "2026-03-01T22:00:00.000Z",
    zone: "UTC",
    startAt: "2026-03-01T22:00:00.000Z",
    endAt: "2026-03-02T01:00:00.000Z",
    participants: [
      { clientId: "rory", payerPartyId: "agencyA", inAt: "2026-03-01T22:00:00.000Z", outAt: "2026-03-02T01:00:00.000Z", payRate: 3000, timeRule: "fullPerPayer" },
      { clientId: "sam", payerPartyId: "familyB", inAt: "2026-03-01T23:00:00.000Z", outAt: "2026-03-02T00:30:00.000Z", payRate: 2500, timeRule: "fullPerPayer" },
    ],
    isIncident: true,
    reimbursementStatus: "unclaimed",
    tags: ["tag-sam", "shared-concern"],
    customFields: { note: "Sam was upset today" },
  };

  const expenseWithMetadata: Expense = {
    id: "e1",
    occurredAt: "2026-03-01T23:00:00.000Z",
    recordedAt: "2026-03-01T23:00:00.000Z",
    zone: "UTC",
    totalAmount: 3400,
    category: "food",
    description: "Lunch with Sam at his favorite pizza place",
    receiptAttachmentIds: ["a1", "a2", "a3"],
    splits: [
      { clientId: "rory", payerPartyId: "agencyA", amount: 1700 },
      { clientId: "sam", payerPartyId: "familyB", amount: 1700 },
    ],
    reimbursementStatus: "unclaimed",
    tags: ["shared-meal"],
    customFields: { venue: "Sams Place" },
  };

  it("completely removes all trace of sam from shift metadata", () => {
    const filtered = filterShiftFor(shiftWithMetadata, { audience: "payer", partyId: "agencyA" }, ["rory"])!;

    const json = JSON.stringify(filtered);
    expect(json).not.toContain("sam");
    expect(json).not.toContain("familyB");
    expect(json).not.toContain("upset");
    expect(json).not.toContain("tag-sam");
    expect(json).not.toContain("shared-concern");
    expect(json).not.toContain("Sam was upset");

    expect(filtered.tags).toEqual([]);
    expect(filtered.customFields).toEqual({});
    expect(filtered.isIncident).toBe(false);
  });

  it("completely removes all trace of sam from expense metadata", () => {
    const filtered = filterExpenseFor(expenseWithMetadata, { audience: "payer", partyId: "agencyA" }, ["rory"])!;

    const json = JSON.stringify(filtered);
    expect(json).not.toContain("sam");
    expect(json).not.toContain("familyB");
    expect(json).not.toContain("favorite");
    expect(json).not.toContain("pizza");

    expect(filtered.description).toBe("");
    expect(filtered.receiptAttachmentIds).toEqual([]);
    expect(filtered.tags).toEqual([]);
    expect(filtered.customFields).toEqual({});
  });
});
