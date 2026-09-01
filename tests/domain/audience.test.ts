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

function clientEvent(id: string, deleted?: boolean): DomainEvent {
  const fields: Record<string, unknown> = { name: id, displayInitial: id[0], colour: "blue", archived: false, attachmentIds: [] };
  if (deleted) fields.deleted = true;
  return {
    eventId: id,
    entityType: "client",
    entityId: id,
    fields,
    recordedAt: "2026-01-01T00:00:00.000Z",
    deviceId: "dev-a",
    seq: 1,
  };
}

// Agency A pays for Rory. Family B pays for Sam. Grandmother is Rory's guardian.
const store = replay([
  clientEvent("rory"),
  clientEvent("sam"),
  roleEvent("r1", "rory", "agencyA", "payer"),
  roleEvent("r2", "sam", "familyB", "payer"),
  roleEvent("r3", "rory", "gran", "guardian"),
]);

// Store with a deleted client
const storeWithDeletedClient = replay([
  clientEvent("rory"),
  clientEvent("sam", true),
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

// Shift where hidden participant extends beyond visible one
const shiftWithExtendingParticipant: Shift = {
  id: "s2",
  occurredAt: "2026-03-01T20:00:00.000Z",
  recordedAt: "2026-03-01T20:00:00.000Z",
  zone: "UTC",
  startAt: "2026-03-01T20:00:00.000Z",
  endAt: "2026-03-02T02:00:00.000Z",
  participants: [
    { clientId: "rory", payerPartyId: "agencyA", inAt: "2026-03-01T22:00:00.000Z", outAt: "2026-03-02T01:00:00.000Z", payRate: 3000, timeRule: "fullPerPayer" },
    { clientId: "sam", payerPartyId: "familyB", inAt: "2026-03-01T20:00:00.000Z", outAt: "2026-03-02T02:00:00.000Z", payRate: 2500, timeRule: "fullPerPayer" },
  ],
  isIncident: true,
  reimbursementStatus: "unclaimed",
  tags: ["tag-sam"],
  customFields: { note: "Sam's concern" },
};

const sharedReceiptExpense: Expense = {
  id: "e1",
  occurredAt: "2026-03-01T23:00:00.000Z",
  recordedAt: "2026-03-01T23:00:00.000Z",
  zone: "UTC",
  totalAmount: 3400,
  category: "food",
  description: "Lunch with Sam at pizza place",
  receiptAttachmentIds: ["a1", "a2"],
  splits: [
    { clientId: "rory", payerPartyId: "agencyA", amount: 1700 },
    { clientId: "sam", payerPartyId: "familyB", amount: 1700 },
  ],
  reimbursementStatus: "unclaimed",
  tags: [],
  customFields: {},
};

const singleSplitExpense: Expense = {
  id: "e2",
  occurredAt: "2026-03-01T23:00:00.000Z",
  recordedAt: "2026-03-01T23:00:00.000Z",
  zone: "UTC",
  totalAmount: 1700,
  category: "food",
  description: "Just for Rory",
  receiptAttachmentIds: ["a3"],
  splits: [{ clientId: "rory", payerPartyId: "agencyA", amount: 1700 }],
  reimbursementStatus: "unclaimed",
  tags: [],
  customFields: {},
};

describe("clientsVisibleTo", () => {
  it("shows every non-deleted client to me", () => {
    expect(clientsVisibleTo(store, { audience: "me" }).sort()).toEqual(["rory", "sam"]);
  });

  it("excludes deleted clients from me", () => {
    expect(clientsVisibleTo(storeWithDeletedClient, { audience: "me" })).toEqual(["rory"]);
  });

  it("shows a payer only the clients they pay for (non-deleted)", () => {
    expect(clientsVisibleTo(store, { audience: "payer", partyId: "agencyA" })).toEqual(["rory"]);
  });

  it("excludes deleted clients from payer view", () => {
    expect(clientsVisibleTo(storeWithDeletedClient, { audience: "payer", partyId: "familyB" })).toEqual([]);
  });

  it("shows a guardian only their own child (non-deleted)", () => {
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
    const visibleClients = clientsVisibleTo(store, ctx);
    const filtered = filterShiftFor(mixedShift, ctx, visibleClients)!;
    expect(filtered.participants).toHaveLength(1);
    expect(filtered.participants[0].clientId).toBe("rory");
  });

  it("leaks no trace of the other client anywhere in the output", () => {
    const visibleClients = clientsVisibleTo(store, ctx);
    const filtered = filterShiftFor(mixedShift, ctx, visibleClients)!;
    expect(JSON.stringify(filtered)).not.toContain("sam");
    expect(JSON.stringify(filtered)).not.toContain("familyB");
  });

  it("returns null when the audience has no participant on the shift", () => {
    expect(filterShiftFor(mixedShift, { audience: "payer", partyId: "stranger" }, [])).toBeNull();
  });

  it("returns a copy for me, not the same reference", () => {
    const visibleClients = clientsVisibleTo(store, { audience: "me" });
    const filtered = filterShiftFor(mixedShift, { audience: "me" }, visibleClients)!;
    expect(filtered).toEqual(mixedShift);
    expect(filtered).not.toBe(mixedShift);
    expect(filtered.participants).not.toBe(mixedShift.participants);
  });

  it("strips pay rates from a guardian's view", () => {
    const guardianCtx: AudienceContext = { audience: "guardian", partyId: "gran" };
    const visibleClients = clientsVisibleTo(store, guardianCtx);
    const filtered = filterShiftFor(mixedShift, guardianCtx, visibleClients)!;
    expect(filtered).not.toBeNull();
    expect(filtered.participants[0]).not.toHaveProperty("payRate");
  });

  it("strips payerPartyId from a guardian's view", () => {
    const guardianCtx: AudienceContext = { audience: "guardian", partyId: "gran" };
    const visibleClients = clientsVisibleTo(store, guardianCtx);
    const filtered = filterShiftFor(mixedShift, guardianCtx, visibleClients)!;
    expect(filtered).not.toBeNull();
    expect(filtered.participants[0]).not.toHaveProperty("payerPartyId");
  });

  it("returns null when payer context has no partyId", () => {
    expect(filterShiftFor(mixedShift, { audience: "payer" }, ["rory"])).toBeNull();
  });

  it("returns null when guardian context has no partyId", () => {
    expect(filterShiftFor(mixedShift, { audience: "guardian" }, ["rory"])).toBeNull();
  });

  it("fails closed when payerPartyId is missing", () => {
    const shiftWithoutPayerPartyId: Shift = {
      ...mixedShift,
      participants: [
        { clientId: "rory", payerPartyId: undefined as any, inAt: "2026-03-01T22:00:00.000Z", outAt: "2026-03-02T01:00:00.000Z", payRate: 3000, timeRule: "fullPerPayer" },
      ],
    };
    expect(filterShiftFor(shiftWithoutPayerPartyId, ctx, ["rory"])).toBeNull();
  });

  it("does not expose tags and customFields to non-me audience", () => {
    const visibleClients = clientsVisibleTo(store, ctx);
    const filtered = filterShiftFor(shiftWithExtendingParticipant, ctx, visibleClients)!;
    expect(filtered.tags).toEqual([]);
    expect(filtered.customFields).toEqual({});
  });

  it("does not expose isIncident to non-me audience", () => {
    const visibleClients = clientsVisibleTo(store, ctx);
    const filtered = filterShiftFor(shiftWithExtendingParticipant, ctx, visibleClients)!;
    expect(filtered).not.toHaveProperty("isIncident");
  });

  it("excludes participants not in visibleClients even if they match the payer", () => {
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

  it("narrows time window to visible participants' span (extended participant case)", () => {
    const visibleClients = clientsVisibleTo(store, ctx);
    const filtered = filterShiftFor(shiftWithExtendingParticipant, ctx, visibleClients)!;
    // Rory's span is 22:00→01:00, Sam's is 20:00→02:00
    // Filtered should be 22:00→01:00 (Rory's span only)
    expect(filtered.startAt).toBe("2026-03-01T22:00:00.000Z");
    expect(filtered.endAt).toBe("2026-03-02T01:00:00.000Z");
  });

  it("includes deleted field in allow-list", () => {
    const visibleClients = clientsVisibleTo(store, ctx);
    const filtered = filterShiftFor(mixedShift, ctx, visibleClients)!;
    expect(filtered).toHaveProperty("deleted");
  });
});

describe("filterExpenseFor", () => {
  const ctx: AudienceContext = { audience: "payer", partyId: "agencyA" };

  it("shows a payer only their own split and restates the total as their share", () => {
    const visibleClients = clientsVisibleTo(store, ctx);
    const filtered = filterExpenseFor(sharedReceiptExpense, ctx, visibleClients)!;
    expect(filtered.splits).toHaveLength(1);
    expect(filtered.totalAmount).toBe(1700);
  });

  it("leaks no trace of the other family", () => {
    const visibleClients = clientsVisibleTo(store, ctx);
    const filtered = filterExpenseFor(sharedReceiptExpense, ctx, visibleClients)!;
    expect(JSON.stringify(filtered)).not.toContain("sam");
    expect(JSON.stringify(filtered)).not.toContain("familyB");
  });

  it("returns null when none of the splits belong to the audience", () => {
    expect(filterExpenseFor(sharedReceiptExpense, { audience: "payer", partyId: "stranger" }, [])).toBeNull();
  });

  it("returns a copy for me, not the same reference", () => {
    const visibleClients = clientsVisibleTo(store, { audience: "me" });
    const filtered = filterExpenseFor(sharedReceiptExpense, { audience: "me" }, visibleClients)!;
    expect(filtered).toEqual(sharedReceiptExpense);
    expect(filtered).not.toBe(sharedReceiptExpense);
    expect(filtered.splits).not.toBe(sharedReceiptExpense.splits);
  });

  it("returns null when payer context has no partyId", () => {
    expect(filterExpenseFor(sharedReceiptExpense, { audience: "payer" }, ["rory"])).toBeNull();
  });

  it("returns null when guardian context has no partyId", () => {
    expect(filterExpenseFor(sharedReceiptExpense, { audience: "guardian" }, ["rory"])).toBeNull();
  });

  it("fails closed when payerPartyId is missing", () => {
    const expenseWithoutPayerPartyId: Expense = {
      ...sharedReceiptExpense,
      splits: [{ clientId: "rory", payerPartyId: undefined as any, amount: 1700 }],
    };
    expect(filterExpenseFor(expenseWithoutPayerPartyId, ctx, ["rory"])).toBeNull();
  });

  it("strips description and receiptAttachmentIds from shared-receipt expenses", () => {
    const visibleClients = clientsVisibleTo(store, ctx);
    const filtered = filterExpenseFor(sharedReceiptExpense, ctx, visibleClients)!;
    expect(filtered.description).toBe("");
    expect(filtered.receiptAttachmentIds).toEqual([]);
  });

  it("includes description and receiptAttachmentIds when expense has exactly one split", () => {
    const visibleClients = clientsVisibleTo(store, ctx);
    const filtered = filterExpenseFor(singleSplitExpense, ctx, visibleClients)!;
    expect(filtered.description).toBe("Just for Rory");
    expect(filtered.receiptAttachmentIds).toEqual(["a3"]);
  });

  it("does not expose tags and customFields to non-me audience", () => {
    const visibleClients = clientsVisibleTo(store, ctx);
    const filtered = filterExpenseFor(sharedReceiptExpense, ctx, visibleClients)!;
    expect(filtered.tags).toEqual([]);
    expect(filtered.customFields).toEqual({});
  });

  it("does not expose reimbursementStatus to non-me audience", () => {
    const visibleClients = clientsVisibleTo(store, ctx);
    const filtered = filterExpenseFor(sharedReceiptExpense, ctx, visibleClients)!;
    expect(filtered).not.toHaveProperty("reimbursementStatus");
  });

  it("excludes splits not in visibleClients even if they match the payer", () => {
    const expenseWithCharlie: Expense = {
      ...sharedReceiptExpense,
      splits: [
        { clientId: "rory", payerPartyId: "agencyA", amount: 1700 },
        { clientId: "charlie", payerPartyId: "agencyA", amount: 1700 },
      ],
    };
    const filtered = filterExpenseFor(expenseWithCharlie, ctx, ["rory"])!;
    expect(filtered.splits).toHaveLength(1);
    expect(filtered.splits[0].clientId).toBe("rory");
  });

  it("strips payerPartyId from guardian expense splits", () => {
    const guardianCtx: AudienceContext = { audience: "guardian", partyId: "gran" };
    const visibleClients = clientsVisibleTo(store, guardianCtx);
    const filtered = filterExpenseFor(singleSplitExpense, guardianCtx, visibleClients)!;
    expect(filtered.splits[0]).not.toHaveProperty("payerPartyId");
  });

  it("includes deleted field in allow-list", () => {
    const visibleClients = clientsVisibleTo(store, ctx);
    const filtered = filterExpenseFor(sharedReceiptExpense, ctx, visibleClients)!;
    expect(filtered).toHaveProperty("deleted");
  });
});

describe("filterNotesFor", () => {
  const noteOnMixedShift: Note[] = [
    {
      id: "n1",
      body: "private thought",
      attachedToType: "shift",
      attachedToId: "s1",
      clientId: "rory",
      visibility: { me: true, payer: false, guardian: false },
      occurredAt: "x",
      recordedAt: "x",
      zone: "UTC",
      tags: [],
      customFields: {},
    },
    {
      id: "n2",
      body: "for the agency",
      attachedToType: "shift",
      attachedToId: "s1",
      clientId: "rory",
      visibility: { me: true, payer: true, guardian: false },
      occurredAt: "x",
      recordedAt: "x",
      zone: "UTC",
      tags: [],
      customFields: {},
    },
    {
      id: "n3",
      body: "for gran",
      attachedToType: "shift",
      attachedToId: "s1",
      clientId: "rory",
      visibility: { me: true, payer: false, guardian: true },
      occurredAt: "x",
      recordedAt: "x",
      zone: "UTC",
      tags: [],
      customFields: {},
    },
    {
      id: "n4",
      body: "Sam had a meltdown",
      attachedToType: "shift",
      attachedToId: "s1",
      clientId: "sam",
      visibility: { me: true, payer: true, guardian: false },
      occurredAt: "x",
      recordedAt: "x",
      zone: "UTC",
      tags: [],
      customFields: {},
    },
    {
      id: "n5",
      body: "attached to different shift",
      attachedToType: "shift",
      attachedToId: "s99",
      clientId: "rory",
      visibility: { me: true, payer: true, guardian: false },
      occurredAt: "x",
      recordedAt: "x",
      zone: "UTC",
      tags: [],
      customFields: {},
    },
    {
      id: "n6",
      body: "no clientId",
      attachedToType: "shift",
      attachedToId: "s1",
      visibility: { me: true, payer: true, guardian: false },
      occurredAt: "x",
      recordedAt: "x",
      zone: "UTC",
      tags: [],
      customFields: {},
    },
  ];

  it("gives me everything", () => {
    expect(filterNotesFor(noteOnMixedShift, { audience: "me" }, ["rory", "sam"], ["s1", "s99"])).toHaveLength(6);
  });

  it("gives a payer only payer-visible notes for their clients", () => {
    const ctx: AudienceContext = { audience: "payer", partyId: "agencyA" };
    const visibleClients = clientsVisibleTo(store, ctx);
    const filtered = filterNotesFor(noteOnMixedShift, ctx, visibleClients, ["s1"]);
    expect(filtered.map((n) => n.id)).toEqual(["n2"]);
  });

  it("gives a guardian only guardian-visible notes for their children", () => {
    const ctx: AudienceContext = { audience: "guardian", partyId: "gran" };
    const visibleClients = clientsVisibleTo(store, ctx);
    const filtered = filterNotesFor(noteOnMixedShift, ctx, visibleClients, ["s1"]);
    expect(filtered.map((n) => n.id)).toEqual(["n3"]);
  });

  it("never includes a private note in a non-me audience", () => {
    for (const audience of ["payer", "guardian"] as const) {
      const out = filterNotesFor(noteOnMixedShift, { audience, partyId: "x" }, [], ["s1"]);
      expect(out.some((n) => n.body === "private thought")).toBe(false);
    }
  });

  it("excludes notes attached to records the audience cannot see", () => {
    const ctx: AudienceContext = { audience: "payer", partyId: "agencyA" };
    const visibleClients = clientsVisibleTo(store, ctx);
    const filtered = filterNotesFor(noteOnMixedShift, ctx, visibleClients, ["s1"]);
    expect(filtered.map((n) => n.id)).not.toContain("n5");
  });

  it("excludes notes about clients not in visibleClients (cross-family note protection)", () => {
    const ctx: AudienceContext = { audience: "payer", partyId: "agencyA" };
    const filtered = filterNotesFor(noteOnMixedShift, ctx, ["rory"], ["s1"]);
    // n4 is about sam, should be excluded even though it's payer-visible and on s1
    expect(filtered.map((n) => n.id)).not.toContain("n4");
  });

  it("requires clientId to be present", () => {
    const ctx: AudienceContext = { audience: "payer", partyId: "agencyA" };
    const visibleClients = clientsVisibleTo(store, ctx);
    const filtered = filterNotesFor(noteOnMixedShift, ctx, visibleClients, ["s1"]);
    // n6 has no clientId, should be excluded
    expect(filtered.map((n) => n.id)).not.toContain("n6");
  });

  it("requires explicit true for visibility flags, not just truthy", () => {
    const noteWithStringTrue: Note = {
      id: "n7",
      body: "test",
      attachedToType: "shift",
      attachedToId: "s1",
      clientId: "rory",
      visibility: { me: true, payer: "true" as any, guardian: false },
      occurredAt: "x",
      recordedAt: "x",
      zone: "UTC",
      tags: [],
      customFields: {},
    };
    const filtered = filterNotesFor([noteWithStringTrue], { audience: "payer", partyId: "agencyA" }, ["rory"], ["s1"]);
    expect(filtered).toHaveLength(0);
  });

  it("fails closed when visibility object is missing", () => {
    const noteBroken: Note = {
      id: "n8",
      body: "test",
      attachedToType: "shift",
      attachedToId: "s1",
      clientId: "rory",
      visibility: undefined as any,
      occurredAt: "x",
      recordedAt: "x",
      zone: "UTC",
      tags: [],
      customFields: {},
    };
    const filtered = filterNotesFor([noteBroken], { audience: "payer", partyId: "agencyA" }, ["rory"], ["s1"]);
    expect(filtered).toHaveLength(0);
  });

  it("returns a copy of the array for me", () => {
    const notes = [noteOnMixedShift[0]];
    const filtered = filterNotesFor(notes, { audience: "me" }, ["rory"], ["s1"]);
    expect(filtered).not.toBe(notes);
  });
});

describe("Leak check: two-family shift with metadata and cross-family notes", () => {
  const shiftWithAllData: Shift = {
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

  const expenseWithAllData: Expense = {
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

  const crossFamilyNotes: Note[] = [
    {
      id: "n1",
      body: "Sam had a meltdown at 4pm",
      attachedToType: "shift",
      attachedToId: "s1",
      clientId: "sam",
      visibility: { me: true, payer: true, guardian: false },
      occurredAt: "x",
      recordedAt: "x",
      zone: "UTC",
      tags: [],
      customFields: {},
    },
    {
      id: "n2",
      body: "Rory was great today",
      attachedToType: "shift",
      attachedToId: "s1",
      clientId: "rory",
      visibility: { me: true, payer: true, guardian: false },
      occurredAt: "x",
      recordedAt: "x",
      zone: "UTC",
      tags: [],
      customFields: {},
    },
  ];

  it("completely removes all trace of sam from shift metadata", () => {
    const ctx: AudienceContext = { audience: "payer", partyId: "agencyA" };
    const visibleClients = clientsVisibleTo(store, ctx);
    const filtered = filterShiftFor(shiftWithAllData, ctx, visibleClients)!;

    const json = JSON.stringify(filtered);
    expect(json).not.toContain("sam");
    expect(json).not.toContain("familyB");
    expect(json).not.toContain("upset");
    expect(json).not.toContain("tag-sam");
    expect(json).not.toContain("shared-concern");
    expect(json).not.toContain("Sam was upset");

    expect(filtered.tags).toEqual([]);
    expect(filtered.customFields).toEqual({});
    expect(filtered).not.toHaveProperty("isIncident");
  });

  it("completely removes all trace of sam from expense metadata", () => {
    const ctx: AudienceContext = { audience: "payer", partyId: "agencyA" };
    const visibleClients = clientsVisibleTo(store, ctx);
    const filtered = filterExpenseFor(expenseWithAllData, ctx, visibleClients)!;

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

  it("prevents cross-family notes from leaking even when attached to shared shift", () => {
    const ctx: AudienceContext = { audience: "payer", partyId: "agencyA" };
    const visibleClients = clientsVisibleTo(store, ctx);
    const filtered = filterNotesFor(crossFamilyNotes, ctx, visibleClients, ["s1"]);

    expect(filtered.map((n) => n.id)).toEqual(["n2"]);
    expect(filtered.some((n) => n.body.includes("meltdown"))).toBe(false);
  });
});
