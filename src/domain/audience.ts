import type { Id } from "./primitives";
import type { ClientPartyRole, Client, Expense, Note, Shift } from "./entities";
import { live, type EntityStore } from "./replay";

export type Audience = "me" | "payer" | "guardian";

export interface AudienceContext {
  audience: Audience;
  /** The party whose view this is. Ignored when audience is "me". */
  partyId?: Id;
}

/**
 * The clients an audience is allowed to know exist.
 *
 * Spec §7.1: this is a whitelist. Everything else in this module filters BY
 * selecting from this list, never by hiding fields from a full view — so a
 * record that should not be visible is absent rather than redacted.
 */
export function clientsVisibleTo(store: EntityStore, ctx: AudienceContext): Id[] {
  // Build set of deleted client IDs by checking the full store (including deleted records)
  const deletedClientIds = new Set<Id>();
  for (const clientRecord of store.client.values()) {
    if (clientRecord.deleted) {
      deletedClientIds.add(clientRecord.id);
    }
  }

  if (ctx.audience === "me") {
    const roles = live(store, "role") as unknown as ClientPartyRole[];
    return [
      ...new Set(
        roles
          .filter((r) => !deletedClientIds.has(r.clientId))
          .map((r) => r.clientId),
      ),
    ].sort();
  }
  if (!ctx.partyId) return [];
  const wanted = ctx.audience === "payer" ? "payer" : "guardian";
  return (live(store, "role") as unknown as ClientPartyRole[])
    .filter(
      (r) =>
        r.partyId === ctx.partyId &&
        r.role === wanted &&
        !deletedClientIds.has(r.clientId),
    )
    .map((r) => r.clientId)
    .sort();
}

/** Rebuilds a shift containing only what the audience may see, or null.
 *
 * CRITICAL: visibleClients MUST be the result of clientsVisibleTo(store, ctx).
 * Passing any other value defeats the access guard.
 */
export function filterShiftFor(
  shift: Shift,
  ctx: AudienceContext,
  visibleClients: Id[],
): Shift | null {
  if (ctx.audience === "me") {
    // Return a deep copy to prevent mutation of stored record
    return {
      ...shift,
      participants: shift.participants.map((p) => ({ ...p })),
      tags: [...shift.tags],
      customFields: { ...shift.customFields },
    };
  }

  if (!ctx.partyId) return null;

  const participants = shift.participants.filter((p) => {
    if (!visibleClients.includes(p.clientId)) return false;
    // For payer: client must be visible AND match this payer's split
    if (ctx.audience === "payer") return ctx.partyId != null && p.payerPartyId === ctx.partyId;
    // For guardian: client must be visible (partyId already checked above)
    return true;
  });
  if (participants.length === 0) return null;

  // Narrow the time window to only the visible participants' span
  const times = participants.flatMap((p) => [p.inAt, p.outAt]);
  const minInAt = times.reduce((acc, t) => (t < acc ? t : acc));
  const maxOutAt = times.reduce((acc, t) => (t > acc ? t : acc));

  const filteredParticipants = participants.map((p) => {
    if (ctx.audience === "guardian") {
      // A guardian never sees what the worker earns. Spec §7.2.
      const { payRate: _payRate, payerPartyId: _payerPartyId, ...rest } = p;
      return rest as typeof p;
    }
    return p;
  });

  // Build from explicit allow-list only. Never include isIncident — we cannot
  // honestly derive it from visible participants (it applies to the whole shift).
  // Type assertion through unknown is required because the Shift interface requires isIncident,
  // but including it would leak whether any participant (including hidden ones) had an incident.
  return {
    id: shift.id,
    occurredAt: shift.occurredAt,
    recordedAt: shift.recordedAt,
    zone: shift.zone,
    startAt: minInAt,
    endAt: maxOutAt,
    participants: filteredParticipants,
    reimbursementStatus: "unclaimed",
    deleted: shift.deleted,
    tags: [],
    customFields: {},
  } as unknown as Shift;
}

/** Rebuilds an expense containing only the audience's own splits, or null.
 *
 * CRITICAL: visibleClients MUST be the result of clientsVisibleTo(store, ctx).
 * Passing any other value defeats the access guard.
 */
export function filterExpenseFor(
  expense: Expense,
  ctx: AudienceContext,
  visibleClients: Id[],
): Expense | null {
  if (ctx.audience === "me") {
    // Return a deep copy to prevent mutation of stored record
    return {
      ...expense,
      splits: expense.splits.map((s) => ({ ...s })),
      receiptAttachmentIds: [...expense.receiptAttachmentIds],
      tags: [...expense.tags],
      customFields: { ...expense.customFields },
    };
  }

  if (!ctx.partyId) return null;

  const splits = expense.splits.filter((s) => {
    if (!visibleClients.includes(s.clientId)) return false;
    // For payer: client must be visible AND match this payer's split
    if (ctx.audience === "payer") return ctx.partyId != null && s.payerPartyId === ctx.partyId;
    // For guardian: client must be visible (partyId already checked above)
    return true;
  });
  if (splits.length === 0) return null;

  // Strip payerPartyId from guardian splits
  const filteredSplits = splits.map((s) => {
    if (ctx.audience === "guardian") {
      const { payerPartyId: _payerPartyId, ...rest } = s;
      return rest as typeof s;
    }
    return s;
  });

  const totalAmount = splits.reduce((t, s) => t + s.amount, 0);

  // Only include receiptAttachmentIds and description if the expense has exactly
  // one split and that split belongs to this audience. A shared receipt photographs
  // the whole bill, and description is free text that can name another child.
  const isSingleSplit = expense.splits.length === 1 && splits.length === 1;
  const description = isSingleSplit ? expense.description : "";
  const receiptAttachmentIds = isSingleSplit ? expense.receiptAttachmentIds : [];

  // Build from explicit allow-list only. Do not include reimbursementStatus —
  // it is whole-record and leaks whether the other payer submitted a claim.
  // Type assertion through unknown is required because the Expense interface
  // requires reimbursementStatus, but including it violates spec §7.1 scoping.
  return {
    id: expense.id,
    occurredAt: expense.occurredAt,
    recordedAt: expense.recordedAt,
    zone: expense.zone,
    totalAmount,
    category: expense.category,
    description,
    receiptAttachmentIds,
    splits: filteredSplits,
    deleted: expense.deleted,
    tags: [],
    customFields: {},
  } as unknown as Expense;
}

/** Returns only notes whose visibility flag matches the audience AND whose
 * clientId is in visibleClients AND whose attachedToId is in visibleRecordIds.
 *
 * CRITICAL: visibleClients and visibleRecordIds must come from clientsVisibleTo()
 * and prior filterShiftFor/filterExpenseFor calls on the same context.
 * Passing incorrect sets defeats the guard.
 */
export function filterNotesFor(
  notes: Note[],
  ctx: AudienceContext,
  visibleClients: Id[],
  visibleRecordIds: Id[],
): Note[] {
  if (ctx.audience === "me") {
    // Return a copy of the array to prevent mutation by caller
    return [...notes];
  }

  return notes.filter((n) => {
    // First gate: if the note has a clientId, that client must be visible.
    // If no clientId, the note is only visible to "me".
    if (!n.clientId) return false;
    if (!visibleClients.includes(n.clientId)) return false;

    // Second gate: must be attached to a record the audience can see
    if (!visibleRecordIds.includes(n.attachedToId)) return false;

    // Third gate: visibility object must exist and flag must be explicitly true
    if (!n.visibility) return false;
    if (ctx.audience === "payer") return n.visibility.payer === true;
    if (ctx.audience === "guardian") return n.visibility.guardian === true;

    return false;
  });
}
