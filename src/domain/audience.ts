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
    .filter((r) => r.partyId === ctx.partyId && r.role === wanted)
    .map((r) => r.clientId)
    .sort();
}

/** Rebuilds a shift containing only what the audience may see, or null. */
export function filterShiftFor(
  shift: Shift,
  ctx: AudienceContext,
  visibleClients: Id[],
): Shift | null {
  if (ctx.audience === "me") return shift;

  const participants = shift.participants.filter((p) => {
    if (!visibleClients.includes(p.clientId)) return false;
    if (ctx.audience === "payer") return p.payerPartyId === ctx.partyId;
    return true;
  });
  if (participants.length === 0) return null;

  return {
    ...shift,
    participants: participants.map((p) => {
      if (ctx.audience === "guardian") {
        // A guardian never sees what the worker earns. Spec §7.2.
        const { payRate: _payRate, payerPartyId: _payerPartyId, ...rest } = p;
        return rest as typeof p;
      }
      return p;
    }),
  };
}

/** Rebuilds an expense containing only the audience's own splits, or null. */
export function filterExpenseFor(
  expense: Expense,
  ctx: AudienceContext,
  visibleClients: Id[],
): Expense | null {
  if (ctx.audience === "me") return expense;

  const splits = expense.splits.filter((s) => {
    if (!visibleClients.includes(s.clientId)) return false;
    if (ctx.audience === "payer") return s.payerPartyId === ctx.partyId;
    return true;
  });
  if (splits.length === 0) return null;

  // The total is restated as this audience's share; the true total is another
  // payer's business.
  return { ...expense, splits, totalAmount: splits.reduce((t, s) => t + s.amount, 0) };
}

export function filterNotesFor(notes: Note[], ctx: AudienceContext): Note[] {
  if (ctx.audience === "me") return notes;
  return notes.filter((n) =>
    ctx.audience === "payer" ? n.visibility.payer : n.visibility.guardian,
  );
}
