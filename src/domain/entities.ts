import type { Id, Money, ISOInstant, IanaZone } from "./primitives";

/** Fields every record carries. Spec §4. */
export interface BaseRecord {
  id: Id;
  occurredAt: ISOInstant;
  recordedAt: ISOInstant;
  zone: IanaZone;
  deleted?: boolean;
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
  visibility: NoteVisibility;
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
