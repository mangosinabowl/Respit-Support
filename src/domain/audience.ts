import type { Id } from "./primitives";
import type { ClientPartyRole, Expense, Note, Shift } from "./entities";
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
  if (ctx.audience === "me") {
    const roles = live(store, "role") as unknown as ClientPartyRole[];
    return [...new Set(roles.map((r) => r.clientId))].sort();
  }
  if (!ctx.partyId) return [];
  const wanted = ctx.audience === "payer" ? "payer" : "guardian";
  return (live(store, "role") as unknown as ClientPartyRole[])
    .filter((r) => r.partyId === ctx.partyId && r.role === wanted && !r.deleted)
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
    // Return a copy even for "me" to prevent mutation of stored record
    return { ...shift };
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

  // Build from explicit allow-list only
  return {
    id: shift.id,
    occurredAt: shift.occurredAt,
    recordedAt: shift.recordedAt,
    zone: shift.zone,
    startAt: minInAt,
    endAt: maxOutAt,
    participants: filteredParticipants,
    isIncident: false, // Never expose incidents to non-me audience
    reimbursementStatus: shift.reimbursementStatus,
    tags: [],
    customFields: {},
  };
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
    // Return a copy even for "me" to prevent mutation of stored record
    return { ...expense };
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

  const totalAmount = splits.reduce((t, s) => t + s.amount, 0);

  // Build from explicit allow-list only
  return {
    id: expense.id,
    occurredAt: expense.occurredAt,
    recordedAt: expense.recordedAt,
    zone: expense.zone,
    totalAmount,
    category: expense.category,
    description: "", // Never expose free-text description to non-me audience
    receiptAttachmentIds: [], // Never expose shared receipts to non-me audience
    splits,
    reimbursementStatus: expense.reimbursementStatus,
    tags: [],
    customFields: {},
  };
}

/** Returns only notes whose visibility flag matches the audience AND whose
 * attachedToId is a record the audience can see.
 *
 * CRITICAL: visibleRecordIds must be all record IDs the audience can see
 * (from prior filtering calls). Passing an incomplete set defeats the guard.
 */
export function filterNotesFor(
  notes: Note[],
  ctx: AudienceContext,
  visibleRecordIds: Id[],
): Note[] {
  if (ctx.audience === "me") return notes;

  return notes.filter((n) => {
    // First gate: must be attached to a record the audience can see
    if (!visibleRecordIds.includes(n.attachedToId)) return false;

    // Second gate: visibility flag must be explicitly true (not just truthy)
    // Fail closed if visibility is missing or not an object
    if (!n.visibility) return false;
    if (ctx.audience === "payer") return n.visibility.payer === true;
    if (ctx.audience === "guardian") return n.visibility.guardian === true;

    return false;
  });
}
