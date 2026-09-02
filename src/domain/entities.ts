import type { Id, Money, ISOInstant, IanaZone } from "./primitives";

/** Fields every record carries. Spec §4. */
export interface BaseRecord {
  id: Id;
  occurredAt: ISOInstant;
  recordedAt: ISOInstant;
  zone: IanaZone;
  deleted?: boolean;
  /**
   * Put away rather than removed. Archived records stay in every total they
   * belong to - money already owed does not stop being owed because a record
   * was tidied away - they are just kept out of the working views and pickers,
   * and can be restored at any time.
   */
  archived?: boolean;
  tags: Id[];
  customFields: Record<string, string>;
}

export type ReimbursementStatus = "unclaimed" | "submitted" | "paid" | "notReimbursable";
export type TimeRule = "fullPerPayer" | "splitEvenly";
export type MileagePolicy = "share" | "fullPerPayer";
export type PartyRole = "payer" | "guardian" | "emergencyContact";
export type ExpenseCategory = "food" | "activity" | "supplies" | "other";

export interface Party extends BaseRecord {
  kind: "person" | "org";
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  /** Reimbursed per unit distance, in cents. */
  defaultMileageRate: Money;
  mileagePolicy: MileagePolicy;
  timePolicy: TimeRule;
  /** 0 = exact; 15 = round shift durations to quarter hours. */
  roundingMinutes: number;
}

export interface Client extends BaseRecord {
  name: string;
  /**
   * Standing hourly rate in cents, used as the default when a shift starts.
   * Changing it never alters a shift already logged: the rate in force at the
   * time is snapshotted onto the participant (spec 6.3).
   */
  defaultRate?: Money;
  /**
   * How this person's payer settles time when others are present. Per person,
   * not per shift: one family may split a shared hour while an agency pays the
   * full hour regardless of who else was there.
   */
  defaultTimeRule?: TimeRule;
  /** Reimbursed per unit distance, in cents. Snapshotted onto each trip. */
  defaultMileageRate?: Money;

  displayInitial: string;
  colour: string;
  dateOfBirth?: string;
  address?: string;
  allergies?: string;
  accessNotes?: string;
  attachmentIds: Id[];
  archived: boolean;
}

/** Joins a Party to a Client in a role. One Party may hold several. Spec §4.2. */
export interface ClientPartyRole extends BaseRecord {
  clientId: Id;
  partyId: Id;
  role: PartyRole;
}

export interface Participant {
  clientId: Id;
  payerPartyId: Id;
  inAt: ISOInstant;
  outAt: ISOInstant;
  /** Snapshot of the hourly rate in cents. Never recomputed. Spec §6.3. */
  payRate: Money;
  timeRule: TimeRule;
}

export interface Shift extends BaseRecord {
  /** Set when this was pulled back off an invoice that was not paid in full. */
  rejected?: ClaimHistory;
  startAt: ISOInstant;
  /** Null while a timer is running. */
  endAt?: ISOInstant | null;
  participants: Participant[];
  isIncident: boolean;
  reimbursementStatus: ReimbursementStatus;
  submissionId?: Id;
}

export interface MoneySplit {
  clientId: Id;
  payerPartyId: Id;
  amount: Money;
}

export interface Expense extends BaseRecord {
  /** Set when this was pulled back off an invoice that was not paid in full. */
  rejected?: ClaimHistory;
  totalAmount: Money;
  category: ExpenseCategory;
  description: string;
  shiftId?: Id | null;
  receiptAttachmentIds: Id[];
  splits: MoneySplit[];
  reimbursementStatus: ReimbursementStatus;
  submissionId?: Id;
}

export interface TripSplit {
  clientId: Id;
  payerPartyId: Id;
  distanceShare: number;
  /** Snapshot of the rate per unit distance, in cents. */
  rateApplied: Money;
  claimAmount: Money;
}

export interface Trip extends BaseRecord {
  /** Set when this was pulled back off an invoice that was not paid in full. */
  rejected?: ClaimHistory;
  distance: number;
  distanceUnit: "mi" | "km";
  purpose: string;
  isClaimable: boolean;
  odometerStart?: number;
  odometerEnd?: number;
  /** Actual dollars at the pump. Recorded only; NEVER added to a claim. Spec §4.6. */
  fuelCostAmount?: Money;
  shiftId?: Id | null;
  splits: TripSplit[];
  reimbursementStatus: ReimbursementStatus;
  submissionId?: Id;
}

export interface NoteVisibility {
  me: true;
  payer: boolean;
  guardian: boolean;
}

export const NOTE_PRIVATE: NoteVisibility = { me: true, payer: false, guardian: false };

export interface Note extends BaseRecord {
  body: string;
  attachedToType: string;
  attachedToId: Id;
  clientId?: Id;
  visibility: NoteVisibility;
}

/**
 * A photo, held inline as a data URL so it travels with the log: a receipt
 * stored anywhere else would go missing exactly when a payer queried the claim.
 * Images are downscaled before they get here - the log syncs through a Drive
 * file, and a few unshrunk phone photos would dwarf every other record in it.
 */
export interface Attachment extends BaseRecord {
  mimeType: string;
  dataUrl: string;
  bytes: number;
  attachedToType: string;
  attachedToId: Id;
}

/**
 * A late change to what a payer is invoiced, held apart from the record it
 * concerns.
 *
 * The log is append-only and a shift already worked is a fact: it should not be
 * rewritten because a payer negotiated a discount or a receipt was disputed.
 * An adjustment sits alongside, carries the reason, and is applied only when a
 * claim is worked out. The original still reads as what actually happened.
 *
 * A final invoice applies these silently. A draft shows each one with its note,
 * so the worker can check what he is about to send.
 */
export interface Adjustment extends BaseRecord {
  payerPartyId: Id;
  /** What it concerns, for a draft to point at. Blank means the claim overall. */
  targetType?: "shift" | "expense" | "trip";
  targetId?: Id;
  /** Added to the claim, in cents. Negative reduces it. */
  amountDelta: Money;
  note: string;
}

/**
 * A payment received: one invoice, settled.
 *
 * Written when a claim is marked paid, and it keeps the answers a worker needs
 * months later - when, from which payer, for which person, how much, and what
 * the money was for. The individual shifts and receipts carry a "paid" status,
 * but a status cannot say when it was paid or which invoice it belonged to, and
 * that is exactly what gets asked about.
 */
export interface Submission extends BaseRecord {
  /**
   * An invoice, or a redaction against one. A payer who pays part of an invoice
   * does not change what was claimed, so the original is never edited: the
   * amount that came back is recorded against it instead. The pair reads as
   * what was claimed, what was pulled back, and what was actually paid.
   */
  kind?: "invoice" | "redaction";
  /** For a redaction, the invoice it subtracts from. */
  redactsId?: Id;
  payerPartyId: Id;
  clientId: Id;
  clientName: string;
  /** When it went to the payer. An invoice exists once it is sent. */
  issuedAt?: ISOInstant;
  /** When the money arrived. Absent while it is still outstanding. */
  paidAt?: ISOInstant;
  amount: Money;
  time: Money;
  expenses: Money;
  mileage: Money;
  adjustments: Money;
  /** What it settled, so it can all be reopened together if a payment bounces. */
  covers: { shifts: Id[]; expenses: Id[]; trips: Id[] };
  note?: string;
}

/**
 * A record that was claimed once and did not get paid.
 *
 * Refusal is only one way that happens: an invoice can be lost, a payer can go
 * quiet, funding can run out mid-period, or the claim can simply have been
 * wrong and need redoing. The reason is free text for that, and nothing here
 * assumes fault on either side.
 *
 * Carried on the shift, expense or trip itself so it travels with the thing:
 * months later the question is "why is this still unpaid", and the answer has
 * to be attached to the item, not buried in an invoice it is no longer on.
 */
export interface ClaimHistory {
  /** The invoice it came off. */
  fromSubmissionId: Id;
  reopenedAt: ISOInstant;
  reason?: string;
}

export interface Tag extends BaseRecord {
  label: string;
  colour: string;
}

export interface Preset extends BaseRecord {
  kind: "split" | "expense" | "shift";
  label: string;
  payload: Record<string, unknown>;
}
