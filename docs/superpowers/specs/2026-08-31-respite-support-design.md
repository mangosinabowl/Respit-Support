# Respite Support — Design Spec

**Date:** 2026-08-31
**Status:** Approved design, pre-implementation
**Author:** drafted with Claude, decisions made by the app's owner and sole user

---

## 1. What this is

A standalone web app for a respite support worker to record, per client per day:

- time worked (hours and minutes),
- money spent on behalf of clients (food, activities, supplies, other),
- mileage,
- who owes reimbursement for each of the above,

and to turn all of that into something that gets the worker paid, without losing money to
forgotten entries, unclaimed expenses, or unnoticed short payments.

It is used by one person. It runs offline on a phone in the field, and syncs to that person's
own Google Drive so any Android device or Windows computer shows the same data.

### Context

The worker supports mostly children with support needs. Work is a "real mixed bag": different
clients, different payers, sometimes several clients at once from different payers, sometimes
the payer and the guardian are the same person. Records may be entered live during a shift or
backfilled days later.

### Non-goals

- Not a multi-user or team product. One account, one worker.
- Not a formal incident-reporting or behaviour-documentation system. It records that something
  happened and when; the agency's own systems remain the system of record for formal reports.
- Not a payroll or tax-filing system. It produces exports; a human or an accountant files.
- Not a scheduling/rostering tool in v1.

---

## 2. Users, devices, environment

| | |
|---|---|
| Users | One (the worker). No sharing, no accounts for others. |
| Devices | Any Android phone or tablet; any Windows computer. Unbounded number. |
| Primary device | Android phone, used one-handed, often with no signal. |
| Install | PWA installed to the Android home screen from Chrome. |
| Auth | Google sign-in (the account already on the phone). |
| Storage | Local: IndexedDB. Cloud: the user's own Google Drive. |

Because a Windows computer may be borrowed or shared, **signing out must erase the local copy
on that device.**

---

## 3. Core concepts

**Party** — a person or an organisation. An agency, a family, a grandmother, a funding body.
A Party holds **roles** with respect to a Client: *payer*, *guardian*, *emergency contact*. One
Party may hold several roles for the same Client (the guardian who also pays). Roles are
reassignable without re-entering the Party.

**Client** — a person supported. Belongs to one or more Parties by role.

**Shift** — a block of time worked. Has **participants** (one or more Clients), each with their
own in/out time within the shift.

**Expense** — money spent out of pocket, with **splits** assigning portions to Clients/payers.

**Trip** — travel, recorded as distance, with splits, converted to a claimable amount by a rate.

**Note** — free text attached to any record, with per-audience visibility.

**Tag** — a user-created label, attachable to anything.

**Preset** — a user-created, named, reusable set of choices (a split rule, a common expense, a
recurring shift shape) applied in one tap.

**Submission** — a bundle of Shifts/Expenses/Trips claimed from one payer on a date, and the
payment later received against it.

**Audience** — *me*, *payer*, or *guardian*. Determines what appears in a view or export.

---

## 4. Data model

All records share these fields:

| Field | Meaning |
|---|---|
| `id` | Stable unique id, generated on-device (UUID). |
| `occurredAt` | When the thing actually happened. |
| `recordedAt` | When the user entered it. Distinct from `occurredAt` — backfilling must not distort history. |
| `updatedAt` | Last modification (used for last-write-wins). |
| `deviceId` | Device that created the record. |
| `deleted` | Soft-delete flag. Records are never physically removed. |
| `tags[]` | Tag ids. |
| `customFields{}` | User-defined key/value pairs. |

### 4.1 Party

```
id, kind: "person" | "org", name, phone, email, address, notes[], tags[]
defaultMileageRate         // rate this payer reimburses per unit distance
mileagePolicy              // "share" | "fullPerPayer"
timePolicy                 // default split preset for time; ships as "fullPerPayer"
roundingMinutes            // 0 = exact; 15 = round shift durations to quarter hours
submissionCadence          // informational: weekly / fortnightly / monthly
```

### 4.2 ClientPartyRole

```
id, clientId, partyId, role: "payer" | "guardian" | "emergencyContact"
```

A join record, so one Party can hold multiple roles for one Client, and a Client can have
several payers.

### 4.3 Client

```
id, name, displayInitial, colour
dateOfBirth?, address?, allergies?, accessNotes?
attachments[]              // e.g. safety plan PDF — available offline
archived
```

### 4.4 Shift

```
id, startAt, endAt?          // endAt null while a timer is running
participants[]: {
    clientId,
    payerPartyId,            // which payer owes for this client on this shift
    inAt, outAt,             // default to the shift's start/end
    payRate,                 // snapshot of the rate at the time — see §6.3
    splitPresetId            // how time is allocated; default "everyone full time"
}
isIncident                   // flags "something happened"
reimbursementStatus: "unclaimed" | "submitted" | "paid"
submissionId?                // set when claimed
notes[], tags[], customFields{}
```

A Shift with one participant is the ordinary case and must feel no heavier to enter than a
single-client shift would in a simpler app.

### 4.5 Expense

```
id, occurredAt, totalAmount, currency
category: "food" | "activity" | "supplies" | "other"
description
shiftId?                     // optional; expenses can exist outside a shift
receiptAttachmentIds[]
splits[]: { clientId, payerPartyId, amount }
reimbursementStatus: "unclaimed" | "submitted" | "paid" | "notReimbursable"
submissionId?
notes[], tags[], customFields{}
```

**Invariant:** `sum(splits[].amount) == totalAmount`. Enforced; violations surface in the UI in
red and block submission.

`notReimbursable` matters for tax: only unreimbursed expenses are deductible. See §11.

### 4.6 Trip

```
id, occurredAt, distance, distanceUnit
purpose, isClaimable          // commuting vs. travel with/for a client
odometerStart?, odometerEnd?
fuelCostAmount?               // actual dollars at the pump, tracked separately from the claim
shiftId?
splits[]: { clientId, payerPartyId, distanceShare, rateApplied, claimAmount }
reimbursementStatus, submissionId?
notes[], tags[], customFields{}
```

Distance × rate is the claim. `fuelCostAmount` is recorded for the user's own information and
is **never** added to a claim — recording both must not produce a double claim.

### 4.7 Note

```
id, body, attachedToType, attachedToId
visibility: { me: true, payer: bool, guardian: bool }   // me is always true
occurredAt, recordedAt
```

Private by default. Collapsed in the UI to a chip showing an icon and the first few words.

### 4.8 Tag

```
id, label, colour, usageCount
```

Created by typing. Suggested thereafter. Mergeable (§8).

### 4.9 Preset

```
id, kind: "split" | "expense" | "shift"
label
payload                       // the saved configuration
```

Ships with `Everyone full time` (default) and `Split evenly`. The user creates the rest.

### 4.10 Submission

```
id, payerPartyId, periodStart, periodEnd, createdAt
lineItems[]                   // shift/expense/trip ids included
claimedTotal
exportedFormats[]
payments[]: { receivedAt, amount, reference, note }
status: "draft" | "submitted" | "partiallyPaid" | "paid" | "short"
```

`short` is computed, not chosen: claimed minus received, when a payment arrives for less than
the claim.

### 4.11 Attachment

```
id, kind: "receipt" | "document" | "photo"
mimeType, sizeBytes, driveFileId, localBlobKey, capturedAt
```

Images are compressed on-device before upload.

### 4.12 InboxItem

```
id, capturedAt, kind: "photo" | "text" | "timer" | "amount"
payload
resolvedToType?, resolvedToId?     // set once sorted into a real record
```

See §10.

---

## 5. Allocation engine

One engine, used by time, expenses, and mileage. It takes a thing, the participants it concerns,
and a rule, and returns per-payer amounts.

**Hard invariant:** allocations always reconcile back to the true total. The app can never
produce claims summing to more than was spent or worked, and never silently drops a remainder.
Rounding remainders are assigned to the largest share deterministically.

### 5.1 Time

Default rule is **`fullPerPayer`**: every payer owes the full duration their client was present.
Grouping never reduces what the worker is owed. Confirmed by the user: *"if I have more children
then I'm getting paid more… not cut rate."*

Because participants have individual in/out times, the app derives the support ratio for each
stretch of time automatically (e.g. 3–4pm at 1:1, 4–5pm at 1:2, 5–6pm at 1:1). This is displayed
for the user's information and is available to alternative split presets.

Other presets available and user-creatable: `Split evenly` (duration ÷ participants), and
ratio-based rules should a payer ever require them. The rule is chosen per shift at entry time,
defaulting to the payer's `timePolicy`.

**Changing a payer's policy recalculates open (unsubmitted) records only.** Submitted records
are frozen. See §6.3.

### 5.2 Expenses

Default: split evenly across the Clients present at `occurredAt` (or the Clients on the linked
Shift). One tap to accept, or edit to exact amounts per client. A single receipt image stays
attached to every split derived from it.

Line-item splitting is supported (§8) for receipts covering genuinely different things.

### 5.3 Mileage

Same splitting as expenses, over distance. Each payer's `mileagePolicy` decides whether they
receive a share of the distance or the full trip distance. `rateApplied` is snapshotted per split
so later rate changes don't rewrite past claims.

### 5.4 Reconciliation view

For any shift or any day: every minute and every dollar, laid out by payer, with anything
unallocated shown in red. Mixed-bag days are where money disappears; this is the screen that
prevents it.

---

## 6. Rules that protect the money

### 6.1 Two timestamps, always

`occurredAt` and `recordedAt` are separate on every record. A shift backfilled on Thursday for
Tuesday is a Tuesday shift, recorded Thursday. Both facts are kept, and both are exportable —
`recordedAt` is what demonstrates contemporaneous recording if a claim is ever disputed.

### 6.2 Time is stored exactly

Every instant is stored as a UTC timestamp plus the IANA timezone in effect. No calendar API is
involved and none is needed: the device clock is authoritative and self-correcting, and this
approach is correct across daylight saving, device changes, and travel — **and it works with no
signal**, which a network-dependent time source would not.

### 6.3 Rates are snapshotted, never retroactive

`payRate` and `rateApplied` are copied onto the record when it is created. Changing a rate in
settings affects future records and unsubmitted open records; it never rewrites what the worker
was owed in the past.

### 6.4 Submitted records are frozen

Once part of a submitted Submission, a record's financial fields are locked. Corrections are made
by an explicit amendment that is itself recorded, not by silent editing.

### 6.5 Payments reconcile

A Submission tracks payments received, supports partial payments, and computes shortfalls
explicitly: *"claimed $612.40, received $598.00, $14.40 unaccounted for."*

---

## 7. Audiences and visibility

Three audiences: **me**, **payer**, **guardian**.

### 7.1 The confidentiality rule

> **A payer's or guardian's view must never disclose the existence of another payer's or
> another family's client.**

On a shift covering three children from three payers, the packet generated for Agency A contains
only Agency A's client. The other children are **absent** — not redacted, not greyed out, not
present in metadata, filenames, totals, or attachments.

This is enforced by construction: exports are built by *selecting* records for the audience, never
by taking the full view and hiding parts of it. Any export path that could leak is a defect of the
highest severity.

### 7.2 What each audience sees

| | Me | Payer | Guardian |
|---|---|---|---|
| All clients | ✅ | Only theirs | Only theirs |
| Hours worked | ✅ | Their client's | Their client's |
| Pay rates / what the worker earns | ✅ | Their own rate | ❌ |
| Expenses | ✅ | Their splits only | Their child's, if enabled |
| Receipt images | ✅ | ✅ for their splits | Optional |
| Mileage | ✅ | Their splits only | ❌ by default |
| Notes | All | `visibility.payer` only | `visibility.guardian` only |
| Other payers' totals | ✅ | ❌ | ❌ |

A Party holding both *payer* and *guardian* roles sees the union of both — which is why roles are
modelled separately from the Party.

### 7.3 Where audiences appear

Both as an on-screen mode (hand the phone to a guardian) and as generated exports. Entering an
audience mode on screen displays a clear, persistent banner naming whose view is active.

---

## 8. Separate, combine, move

First-class operations, not workarounds:

- **Split a shift** at a chosen instant into two shifts, participants and attachments distributed.
- **Split an expense** into line items, each with its own category, clients, payers and splits.
- **Merge shifts** — for a stopped-and-restarted timer, or the same afternoon logged twice.
- **Merge parties, clients, or tags** — duplicates created with different spellings.
- **Move** any expense, trip, or note between shifts, clients, payers, or to no parent at all.

Because storage is an append-only log (§9), every one of these is expressed as new entries and is
**reversible**. Nothing is destroyed. An undo is available immediately after each operation, and
the history remains recoverable afterwards.

Merging is blocked where it would break a financial invariant (e.g. merging records already
claimed under different submissions) with an explanation of why.

---

## 9. Storage and sync

### 9.1 Local-first

The device's IndexedDB is the source of truth. Every interaction is written locally and
immediately. The app never blocks on the network. Loss of signal is a non-event.

### 9.2 Append-only per-device logs

Each device writes **only to its own file** in a `Respite Support` folder in the user's Google
Drive:

```
Respite Support/
  logs/
    device-<deviceId>.jsonl     # append-only; written by that device only
  attachments/
    <attachmentId>.<ext>
  snapshots/
    <deviceId>-<timestamp>.json # periodic, for fast cold start
```

Each log line is an immutable event: created / updated / deleted / split / merged / moved.

Because no two devices ever write the same file, Drive is never required to merge concurrent
writes, and the silent lost-update failure of a single shared file is structurally impossible.

### 9.3 Rebuilding

On start, the app fetches all logs and replays every event in `updatedAt` order to reconstruct
state. A new or wiped device signs in, replays, and is complete.

### 9.4 Conflicts

Last-write-wins **per field**, not per record — two devices editing different fields of the same
shift both succeed. The superseded value stays in the log and is recoverable.

Where two devices edit the *same* field, the resolution depends on what the field is:

- **Monetary or duration fields** (amounts, splits, start/end times, distances): the later value
  is applied *and* the conflict is added to a review list for the user to confirm. Money is never
  silently overwritten.
- **All other fields** (descriptions, tags, notes, flags): last-write-wins silently.

### 9.5 Attachments

Uploaded separately, referenced by id, compressed before upload, cached locally. A missing
attachment degrades to a placeholder rather than breaking a record.

### 9.6 Compaction

Logs are compacted periodically into snapshots to bound growth; raw logs are retained rather than
deleted, since they are the audit trail.

### 9.7 Auth and scope

Google Identity Services, Drive REST API v3, scope `drive.file` — the app can only see files it
created, and the folder is visible to the user in their own Drive.

**To verify during implementation:** whether `drive.file` triggers Google's unverified-app consent
screen for a personal, unpublished OAuth client, and the exact path through it (test-user
allowlisting vs. the "Advanced → Continue" flow). The user is prepared for a one-time extra tap;
the implementation must confirm and document the actual steps rather than assume them.

---

## 10. Capture in the field

### 10.1 The inbox

The answer to "log it now, sort it later". A single capture action produces an `InboxItem` — a
photo, a fragment of text, a running timer, or just an amount — timestamped, unassigned. The user
sorts it into real records later. The app shows a persistent, gentle count of unsorted items.

This is expected to be the most-used feature and should be reachable in one tap from the app icon.

### 10.2 Backfilling is first-class

Entering Tuesday's shift on Thursday must take the same effort as entering it live. No penalty, no
different screen, no lost accuracy — `occurredAt` is edited freely, `recordedAt` records the truth.

---

## 11. Tax handling

Recorded correctly from day one because it is expensive to unwind later:

- **Reimbursed vs. unreimbursed expenses are distinct.** Only unreimbursed ones are deductible.
  `reimbursementStatus` carries this; `notReimbursable` marks money the worker will not get back.
- **Mileage is logged in the shape tax authorities expect**: date, purpose, distance, and the
  business reason — independent of whether a payer reimbursed it.
- **Tax-year export** produces income, reimbursements received, and unreimbursed deductible
  expenses as separate figures.

Reports are Phase 3; the data model supports them from Phase 1.

---

## 12. Screens

**Today** — landing screen, one-handed. Big start/stop control, the running timer, today's
entries, four-tap expense add, one-tap inbox capture. Add a participant to a running shift without
stopping it.

**Calendar** — month grid; each day shows a dot per client and the day's total. Tap for the day's
detail. The app's own calendar, exact and offline.

**Shift detail** — participants with in/out times, attached expenses and trips, notes as
collapsed chips, and the reconciliation strip with unallocated amounts in red.

**Owed** — the screen that justifies the app: what is owed, by whom, right now, in three columns —
unclaimed, submitted and waiting, paid.

**Clients** — profile, contacts, allergies, access notes, attached documents, all available
offline.

**Parties** — people and organisations, their roles, rates and policies.

**Submissions** — build a packet for a payer over a period, export it, record what was received.

**Inbox** — unsorted captures.

**Settings** — rates, presets, tags, custom fields, audiences, sync status, backup, app lock.

---

## 13. Exports

| Output | Contents |
|---|---|
| **Payer submission packet** (PDF) | Timesheet, itemised expenses, receipt images appended. Audience-filtered per §7.1. |
| **Guardian summary** (PDF) | Their child, what was done, guardian-visible notes. |
| **Accountant CSV** | Flat rows, all records, all fields, unfiltered. |
| **Invoice** (PDF) | For directly-billed families: hours × rate plus passed-through expenses. |
| **Full backup** (ZIP) | Complete JSON plus all attachments. One button, any time. |

The user must never be locked in or dependent on this app continuing to exist.

---

## 14. Guardrails

- **Runaway timer.** A timer running past 8 hours, or across midnight, prompts: *"Still with
  Rory?"* The end time is correctable retroactively.
- **Overlap and duplicate detection.** Warns on overlapping shifts and on suspiciously similar
  entries.
- **Unallocated money** shown in red and blocking submission until resolved.
- **Weekly nudge:** *"3 shifts and $52 unsubmitted."*
- **Missing receipt** on an expense requires explicit confirmation before submission.
- **Empty inbox** nudge.
- **Sync status** always visible and honest: last synced, pending count, and any error — never a
  false green.

---

## 15. Security and privacy

- **App lock**: PIN or device biometric on open.
- **Sign-out wipes local data** — required, because shared or borrowed Windows machines are in
  scope.
- Client information (children's names, allergies, safety plans) lives in the user's own Google
  Drive under their own account. No third-party server, no analytics, no telemetry.
- Attachments are stored in the user's Drive, not embedded in shareable links.
- The confidentiality rule in §7.1 is a security requirement, not a formatting preference.

---

## 16. Extensibility for the unexpected

- **Tags** — user-created labels, no schema change.
- **Custom fields** — user-defined key/value pairs on any record type, for demands nobody
  mentioned at the interview.
- **Presets** — user-created named configurations.
- **Incident flag** — marks a shift as one where something happened, with a timestamped,
  append-only note. Not a formal report; a contemporaneous record.

---

## 17. Technical approach

| Concern | Choice |
|---|---|
| Framework | React + TypeScript, built with Vite |
| Styling | Tailwind, dark mode, large touch targets, thumb-reachable primary actions |
| Local storage | IndexedDB via Dexie |
| Offline | Service worker, full offline capability, installable PWA |
| Cloud | Google Drive REST v3, scope `drive.file` |
| Auth | Google Identity Services |
| PDFs | Client-side generation, no server |
| Hosting | Netlify, free tier, HTTPS (required for PWA install and OAuth) |
| Tests | Vitest, with the allocation engine, audience filtering, and log replay covered first |

There is no backend server. All logic runs on the device; Drive is storage only.

### Testing priorities

The three areas where a defect costs real money or real trust, tested first and hardest:

1. **Allocation engine** — invariants hold, nothing is over- or under-claimed, rounding is exact.
2. **Audience filtering** — no cross-payer or cross-family leakage, under every export path.
3. **Log replay and merge** — no lost edits across devices, split/merge/move are reversible.

---

## 18. Phasing

**Phase 1 — start logging real shifts.**
Clients, parties and roles, multi-participant shifts with per-participant times, expenses with
splits, trips, notes with audience visibility, tags, presets, the inbox, offline operation, Google
Drive sync, the Owed screen, the core guardrails.

**Phase 2 — the paperwork.**
Submissions, the three audience views as exports, payer packets with receipts, payments and
shortfall reconciliation, CSV and invoice exports, full backup.

**Phase 3 — polish and the deferred.**
Google Calendar two-way sync, recurring shift templates, per-client monthly activity budgets with
overspend warnings, guardian sign-off signatures, tax-year reports.

The data model supports all three phases from the start. Nothing in Phase 2 or 3 requires
rebuilding Phase 1.

---

## 19. Open questions

1. **Country, currency, date format, and the mileage rate to ship as default.** "Gas" suggests
   US; unconfirmed.
2. **Mileage approach confirmation.** Carried as an assumption: distance × configurable rate is
   the claim, with pump dollars recorded separately and never claimed. The user was asked and
   deferred; the design keeps both fields so either policy works.
3. **Pay-rate tracking.** Assumed wanted — the app tracks what is owed for time, not only
   out-of-pocket money. Confirm.
4. **Google OAuth verification path** for `drive.file` (§9.7) — to be confirmed empirically.
5. **Netlify hosting** — assumed; requires a Netlify account.
6. **Distance unit** — miles assumed.

None of these block Phase 1 implementation. Each is a settings value or a small, contained
decision.
