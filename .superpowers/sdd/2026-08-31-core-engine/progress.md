# SDD ledger — plan: docs/superpowers/plans/2026-08-31-core-engine.md

Spec: docs/superpowers/specs/2026-08-31-respite-support-design.md (read, reachable)
Branch: core-engine (from main @ 6ff8ff7)

## Setup rulings

Ruling: feature branch instead of a git worktree — the repo was created for this plan and there
is no concurrent work to isolate from; a worktree over a OneDrive path adds a second node_modules
install for no benefit. Cost if wrong: none material; work is on a branch and rebasable.

Ruling: controller performed Task 1 steps 1-2 (git init, .gitignore, staging verification) as
setup rather than delegating. The repo must exist before any git-based dispatch, and the step is
the safety gate protecting a child's safety plan PDF from being committed. Verified: git ls-files
matches no PDF and nothing under Rory/. Cost if wrong: none; independently re-verified at plan end.

## Pre-flight scan

### Cross-task interface pairs

| Producer | Consumer | Interface | Finding |
|---|---|---|---|
| T1 primitives | T2, T4, T5, T7, T11, T12 | Id, Money, ISOInstant, IanaZone, newId, nowInstant, minutesBetween | agree |
| T2 events | T3, T11 | DomainEvent, EntityType, makeEvent, compareEvents | agree |
| T3 replay | T9, T10, T12 | EntityStore, EntityRecord, live, emptyStore | agree |
| T4 entities | T5, T6, T7, T8, T9, T11, T12 | Participant, MoneySplit, Shift, Expense, Trip, Note, ClientPartyRole | agree |
| T5 segments | T7 | segmentsFor -> Segment[] | agree |
| T6 allocation | T11 (declared) | allocateEvenly | **CONFLICT 1** — T11 Interfaces declares it consumes allocateEvenly; T11 code never imports it |
| T7 timeAllocation | T12 | allocateTime -> TimeClaim[] | agree |
| T8 invariants | none in this plan | Violation, checkX | agree (plan 2 consumes) |
| T10 db | none in this plan | RespiteDb, appendEvent, hydrate, nextSeq, deviceId | agree (plans 2-3 consume) |

### Per-task self-agreement (tests vs. code vs. files)

| Task | Finding |
|---|---|
| T1 | **CONFLICT 2** — `npm create vite@latest .` prompts interactively in a non-empty directory; a subagent cannot answer prompts. Also scaffolds demo files this plan never uses. |
| T2 | agrees |
| T3 | agrees |
| T4 | agrees |
| T5 | agrees; zero-duration and non-overlap edges covered |
| T6 | agrees; floor + largest-remainder guarantees the exact-sum constraint |
| T7 | agrees; hand-checked splitEvenly arithmetic (c1=150, c2=30) against segment output |
| T8 | agrees (contradictory fuel-claim test already fixed during plan self-review) |
| T9 | agrees; leak assertions check serialized output, not just field presence |
| T10 | agrees; `deviceId()` touches localStorage but is never called at import, so node tests are safe |
| T11 | **CONFLICT 3** — `moveExpense` writes `{ shiftId: undefined }`. Correct under in-memory replay, but `undefined` does not survive JSON serialization, so once events are written to Drive as JSONL (plan 3) a detach would silently fail to replicate. Latent cross-device data bug. |
| T12 | agrees |

### Rulings on the scan

Ruling (Conflict 1): drop `allocateEvenly` from Task 11's Consumes list; the task genuinely does
not need it and an unused import is noise. Cost if wrong: none — re-adding an import is trivial.

Ruling (Conflict 2): do not run `npm create vite`. Hand-write package.json, tsconfig.json and
vitest.config.ts; install only typescript, vitest, fake-indexeddb, dexie. Vitest bundles its own
vite, and this plan builds no UI, so Vite proper is not needed until plan 2. This trades a
scaffold for three small config files and removes an interactive prompt a subagent cannot clear.
Cost if wrong: plan 2 adds `vite` as a dev dependency — one command.

Ruling (Conflict 3): cleared optional fields use `null`, never `undefined`, so they survive the
JSON round-trip that plans 2-3 depend on. `Expense.shiftId` widens to `Id | null`, and Task 11's
moveExpense test asserts `toBeNull()`. Spec §9.2 makes the log the transport for every device, so
an event that cannot serialize is a defect against the spec even though Task 11 alone passes.
Cost if wrong: a nullable field where an optional one would do — cosmetic.

## Task 1

INCIDENT (contained): the implementer's first `npm install` ran before a local package.json
existed, so npm walked up and modified `C:\Users\aandr\package.json` and its lockfile — an
unrelated home-directory project. The implementer noticed and reverted. Controller independently
verified: home package.json holds only its original web3/Shopify/Slack dependencies with no
devDependencies key; lockfile mentions vitest/dexie/fake-indexeddb zero times; `typescript` in
that node_modules is a pre-existing PEER dep of viem/abitype/web3-eth-abi, not our residue.
No further remediation needed. Cannot recur: the project now owns a package.json, so npm no
longer walks up. Reported to the user immediately rather than deferred to the final summary.

Ruling: continue the plan rather than halting. The side effect is reverted and independently
verified clean, and the structural cause is gone. Cost if wrong: the user's home project has a
lockfile whose byte ordering may differ from before, with identical package content — recoverable
by `npm install` there.
Task 1: complete (commits 6ff8ff7..2ec0eb6, review clean — spec compliant, quality approved)
Task 1: minor (deferred): tsconfig lib includes DOM project-wide, so "no DOM in src/domain" is
  convention not compiler-enforced; consider a scoped tsconfig or lint rule later.
Task 1: minor (deferred): minutesBetween has no direct test (brief's verbatim test omits it);
  exercised indirectly by Tasks 5 and 7.
Task 1: minor (deferred): plain `npm install` resolved bleeding-edge majors — typescript ^7.0.2,
  vitest ^4.1.11, dexie ^4.4.5. `tsc --noEmit` passed. Flag to user; revisit if toolchain misbehaves.
Task 2: complete (commits 2ec0eb6..1661e83, review clean — verbatim transcription verified)
Task 2: ⚠️ resolved by controller: reviewer could not verify "every record carries occurredAt and
  recordedAt" from this diff. Not a gap — the constraint binds domain RECORDS (BaseRecord, defined
  in Task 4), not DomainEvent, which is a change record and correctly carries only recordedAt.
  Task 4 defines both fields on BaseRecord; verify there.
Task 2: minor (deferred): `fields: Record<string, unknown>` has no compile-time guard against a
  caller putting a Date object in; it would survive JSON as a string, not a Date. Carry this into
  Task 11's dispatch, which spreads whole entities into `fields`.

## Task 3

Ruling: the reviewer's Important finding (undefined-valued fields vanish on JSON round-trip,
silently defeating a field-clear under last-write-wins) is upheld and fixed here rather than
parked, and it SUPERSEDES the narrower preflight Conflict-3 ruling. The preflight ruling scoped
null-not-undefined to Task 11's moveExpense; the reviewer correctly located the problem in replay
itself, which is where every consumer meets it. Fix: make `null` the sanctioned field-clear,
document the invariant in replay.ts, and prove it with a test that JSON round-trips a stream and
replays identically. Spec §9.2 makes the log the transport between devices, so an event that
cannot survive serialization is a defect against the spec regardless of the plan's own test file
omitting the case. Cost if wrong: two extra tests and a doc comment.

Ruling: bundle two minors into the same fix round rather than deferring them — a regression test
for the untested unknown-entityType guard, and correcting inaccurate line counts in the report
file. Both touch the files already open in this round; deferring them costs another dispatch
later for less than they cost now. Cost if wrong: negligible.
Task 3: fix round 1/5 (1 addressed, 2 open — Finding 1 null/JSON invariant fully addressed with
  doc comment + 3 tests incl. a genuine hazard demonstration; Finding 2 unknown-entityType test
  asserts the wrong bucket so it proves "doesn't throw" but not "creates no bucket"; Finding 3
  report line counts never actually corrected despite the fix report claiming they were;
  commits c0eec06..901e069)
Task 3: fix round 2/5 (1 addressed, 1 open — Finding 2 test now asserts store shape and passes a
  mutation check: fails with an auto-vivifying guard, passes with the correct one, both outputs in
  the report; Finding 3 replay.test.ts line count reads 131, actual 127; commits 901e069..24eb080)

Ruling: withdraw Finding 3 from the fix loop rather than run a third round. This corrects my own
earlier bundling decision, not an early adjudication of a code finding: Finding 3 was a Minor,
and Minors never had standing to enter the loop. Its entire residue is a line count off by four
inside `.superpowers/`, a git-ignored scratch report that is deleted when this plan completes. It
touches no committed code and no deliverable. The substantive half — the false round-1 claim —
was verified corrected. Cost if wrong: a wrong number in a file nobody reads before it is deleted.

Task 3: complete (commits 1661e83..24eb080, review clean — 1 withdrawn minor)

## Task 4

Ruling: uphold both Important findings (the `shiftId?: Id | null` amendment is untested; Trip has
zero test coverage) and fix them rather than park. The amendment exists to guarantee a value is
assignable; an unasserted guarantee is not one, and nothing in the suite would fail if the type
reverted. Cost if wrong: two small type-shape tests.

Ruling: extend the null-clear amendment to `Shift.endAt`, which the reviewer raised only as a
Minor. Its doc comment already reads "Null while a timer is running" while its type permits only
`ISOInstant | undefined` — the comment and the type disagree, and the type is the one that is
wrong. A running shift is precisely a shift whose end has been cleared, and under the Task 3
invariant a cleared field is `null`. Downstream consumers use truthiness (`if (!shift.endAt)`),
so widening breaks nothing. Cost if wrong: an unused `null` in a union.
Task 4: fix round 1/5 (3 addressed, 0 open — shiftId null tests, Trip coverage incl. the
  fuel-must-not-inflate-a-claim rule, endAt widened to ISOInstant | null; commits ec14aff..4a4343a)
Task 4: complete (commits 24eb080..4a4343a, review clean)

Ruling: add a real typecheck step, folded into Task 5's dispatch. The Task 4 re-reviewer justified
its ADDRESSED verdict by claiming the new tests "would cause TypeScript compile errors if the type
reverted" — true of tsc, but Vitest does not type-check, so `npm test` would pass anyway. That
makes every type-shape test in this plan decorative, and it silently weakens the verification of
the null-clear invariant three reviewers have now defended. Fix: `"typecheck": "tsc --noEmit"` and
`"test": "tsc --noEmit && vitest run"`. Assigned to Task 5 rather than done in the controller
session so it passes through review like any other change. Cost if wrong: a slower test command;
if tsc surfaces pre-existing errors, that is information worth having now rather than at the end.
Task 5: complete (commits 4a4343a..0dd64bb, review clean — typecheck step verified as its own
  commit, and the reviewer independently ran `tsc --noEmit` clean on Tasks 1-5)
Task 5: minor (deferred): report line counts off by one again (37/60 actual vs 38/61 claimed).
  Third occurrence of unreliable self-reported metrics across three different implementers;
  scratch file only, but note it for the final review.

Ruling: the missing exact-boundary-adjacency test (one participant's outAt equalling another's
inAt — a child collected at the moment another is dropped off) is carried into Task 7's dispatch
rather than fixed in a Task 5 round. The reviewer proved by hand-trace that segmentsFor handles it
correctly, so this is coverage, not a defect; and the scenario only costs money once time
allocation consumes it, which is Task 7. Testing it there exercises the handover end to end
instead of in isolation. Cost if wrong: a common real-world scenario stays unasserted one task
longer than necessary.

## Task 6

Ruling: fix the Important (negative totals untested) plus two related Minors in one round, rather
than deferring. Ordinarily inherited-from-the-brief coverage gaps get carried forward, but this is
the module carrying the plan's central money guarantee, and refunds/corrections are a real path in
an expense flow. The reviewer proved the algorithm is already sign-agnostic and correct — so the
risk is not today's behavior but a future edit (an "amount must be positive" guard, a rounding-mode
change) silently breaking it with no test to catch it. Cost if wrong: a slightly longer test file.

Ruling: reject negative weights outright rather than documenting the quirk. `totalWeight === 0`
currently triggers the even-split fallback for ANY weights summing to zero, so `[5, -5, 0]`
silently becomes an even three-way split instead of an error. A negative weight in money
apportionment is meaningless, and silently reinterpreting it misallocates real money. No caller
passes weights today, so tightening now is free. Cost if wrong: a caller wanting negative weights
must be revisited — but no sensible caller does.
Task 6: fix round 1/5 (3 addressed, 0 open — exhaustive sweep extended to -500..500 (7,007
  combinations) without weakening positive coverage; refund assertion committed as exactly
  [-1133,-1133,-1134] matching the independent hand-trace rather than adjusted to fit output;
  negative-weight guard throws and the all-zero fallback now tests every(w===0) not sum===0;
  commits 4c7360d..4cffad0)
Task 6: complete (commits 0dd64bb..4cffad0, review clean)

## Task 7

Ruling: uphold and fix the Important finding — a client appearing twice in one shift (leaves for an
appointment, returns) overwrites rather than accumulates minutes, and emits one claim per
participant ENTRY, so the same client appears twice both showing the last stay's duration. The
reviewer empirically produced 2×120min billed for a real 60+120min shift. This is a defect in the
plan's own code, untested by the plan's own tests, and it misbills in either direction depending
on which stay is longer. A child leaving mid-shift and returning is ordinary in respite work.
Cost if wrong: none — accumulating is strictly more correct than overwriting.

Ruling: keep splitEvenly's existing double-rounding (round minutes, then derive amount from the
rounded minutes) rather than computing amount from fractional minutes. The worker hands payers a
figure they check by multiplying minutes by the rate; if amount were derived from an unrounded
value the payer's own arithmetic would not reconcile, which is worse than a sub-cent divergence.
Add a test pinning the choice so it is deliberate rather than accidental. Cost if wrong: at most
a cent or two on odd-numbered group splits, in exchange for arithmetic the payer can verify.

Ruling: `test-output.txt`, an untracked artifact left by the implementer's test run, gets removed
and gitignored. Stray build output in the working tree is how unrelated files eventually get
committed by an `git add -A`, and this repo holds client material one directory up.
Task 7: fix round 1/5 (3 addressed, 0 open — fullPerPayer now accumulates; claims grouped by
  clientId+payerPartyId preserving first-appearance order with first-seen payRate; no pre-existing
  assertion altered (verified against the diff, not just claimed); splitEvenly rounding order
  pinned by a 100/3 test; test-output.txt removed and gitignored; commits 941ff90..9662c85)

Ruling: accept the duplicate-stay test using 60+60 minutes rather than the 60+120 I specified.
Asymmetric stays would additionally reveal WHICH stay an overwrite kept, but the committed test
still fails under the overwrite bug (60 vs 120), which is the property that matters. Not worth a
round to change the numbers. Cost if wrong: a marginally less diagnostic failure message.

Task 7: complete (commits 4cffad0..9662c85, review clean)

## Task 8

Reviewer ran mutation testing in a scratch project: it mutated the committed module and re-ran the
suite to see which defects the tests failed to catch. Four mutants survived — the transcription is
byte-perfect but the brief's own tests leave the most consequential behaviours unpinned.

Ruling: fix all four surviving mutants. Flipping the over/under comparison at invariants.ts:57
leaves 17/17 green, meaning the exact failure this module exists to prevent — telling the worker
he over-claimed when he under-claimed — is invisible to the suite. Same for trip NO_SPLITS (never
reached, because the only empty-splits fixture is non-claimable and early-returns), the 1-cent
exact-sum boundary (a tolerance could be introduced unnoticed), and endAt: null (entities.ts
documents null as THE running-timer representation, yet only undefined is tested).

Ruling: fix the two brief-level gaps the reviewer found beyond the mutants, both wrong-money holes
in a module whose entire purpose is blocking wrong money. (a) Date.parse returns NaN on a malformed
timestamp and every NaN comparison is false, so a shift with a corrupted endAt currently validates
CLEAN and is fully submittable. (b) checkExpense has NON_POSITIVE_TOTAL but checkTrip has no
positivity guard, so a negative distanceShare with a consistent negative claimAmount validates
clean and credits the payer. Both are additive — more violations means more blocking, which is the
safe direction for a guard — and Task 9's gating consumes codes, so new codes do not break it.
Cost if wrong: a slightly stricter guard than the brief specified.

Ruling: the report's stated reason for its `: any` divergence is false — the reviewer compiled a
probe under the repo's strict settings showing Violation is inferred correctly. Drop the
annotations (they disable property checking on the assertion side) and correct the report.

Carry-forward (not fixed here, no conflict today): invariants.ts:89 checks claimAmount against
Math.round(distanceShare * rateApplied), which is float multiplication and not IEEE-safe at exact
halves. Nothing in this plan PRODUCES claimAmount — Task 12 only sums it — so the producer is
outside this plan. Whoever writes it must use this same rounding or trips will be falsely flagged
CLAIM_MISMATCH.
Task 8: fix round 1/5 — all four mutants re-run against the fixed code and KILLED by named tests
  (message direction killed in BOTH directions now that full strings are asserted; NO_SPLITS;
  1-cent boundary; endAt: null). Both new guards runtime-verified. No pre-existing assertion
  weakened — the reviewer accounted for all 8 deleted test lines individually. Commit 7c9cf82.

Ruling: KEEP the zero-boundary inconsistency the reviewer flagged — checkExpense rejects a $0.00
total (<= 0) while checkTrip accepts a $0.00 claim (< 0). This looks like sloppiness but is the
safer asymmetry. A $0.00 expense is unambiguously an error; nobody records a receipt for nothing.
A $0.00 trip split can arise legitimately: the allocation engine uses largest-remainder, so a
small distanceShare in a multi-client split can round to zero cents honestly. Making trips reject
zero would block the worker from submitting a correct multi-client trip, whereas accepting it
admits a harmless $0 line item where no money moves. False rejection costs him a submission he
cannot fix; false acceptance costs nothing. Pin the choice with a test so it is deliberate rather
than accidental. Cost if wrong: a meaningless zero-value line on a claim.

Ruling: leave the "$-34.00 is not assigned to anyone." rendering on a negative total. Formatting
the absolute value would say "$34.00" for a -$34.00 total, which misstates the figure; the message
is only reachable alongside NON_POSITIVE_TOTAL, which is the actionable signal.

Carry-forward for Task 9: the gating switch must handle the two NEW violation codes added here,
BAD_TIMESTAMP and NEGATIVE_CLAIM, which are not in the Task 9 brief's text.

Carry-forward: a running shift (STILL_RUNNING) short-circuits before the timestamp guards, so
startAt and participant times go unvalidated while the timer runs. Correct as designed —
STILL_RUNNING already blocks submission — but Task 9 must not treat "no violations other than
STILL_RUNNING" as "timestamps validated".
Task 8: fix round 2/5 — zero-boundary choice pinned by a named test plus an explanatory comment at
  the guard; report's false : any justification, stale scope line, and wrong line counts corrected
  (now 186/223, matching wc -l). Verified by the controller directly rather than by a review
  dispatch: guard comparisons confirmed untouched, full suite run to ground truth at 84 passing.
  Commit bdb3085.

Task 8: complete (commits cbe4456..bdb3085, all four mutants killed, 84 tests green)

CORRECTION to the Task 8 carry-forward above: Task 9 is audience filtering, NOT submission gating.
Grepping every brief for checkExpense/checkShift/checkTrip shows the ONLY hit outside Task 8 is a
single Task 12 note saying the runaway-timer guardrails "need a UI to surface in (plan 2)". So
nothing in this plan wires invariants.ts into anything — it is built, tested, and unconsumed.
That is consistent with this plan being the headless core (the UI in plan 2 is the caller), but it
means the guard is unexercised end-to-end here. SURFACE THIS TO THE USER in the final report: the
two codes added in Task 8 (BAD_TIMESTAMP, NEGATIVE_CLAIM) and the STILL_RUNNING short-circuit
caveat all need to be honoured by whatever plan-2 code calls these functions.

## Task 9 — highest-severity task, brief's own design found leaking

Reviewer ran 19 constructed leak attempts against the committed module in a scratch project. Six
leaked. The transcription was faithful; the DESIGN in my plan is what leaks. Rulings:

UPHOLD C1 (spread carries whole-record fields). filterShiftFor/filterExpenseFor rebuild with
{...shift} and replace two fields, so tags, customFields, submissionId, isIncident, description
and receiptAttachmentIds — all computed across ALL families — reach every audience verbatim. The
demonstrated case is damning: a lunch split 1700/1700 has totalAmount carefully restated to 1700
for agencyA, then hands them receiptAttachmentIds ["a1"], the single photo of the whole £34 bill,
plus submissionId "sub-familyB". The restatement is undone by the attachment. This directly
violates the brief's own stated principle that filtering selects rather than redacts. FIX by
constructing the return from an explicit allow-list of fields. No caller misuse required to leak.

UPHOLD C2 (filterNotesFor unscoped). It reads only ctx.audience and the note's own flag; ctx.partyId
is accepted and never used. A payer with ZERO role records receives every payer-visible note. A note
reading "Sam had a meltdown at 4pm" on a mixed shift goes to the other family's agency and, if
guardian-visible, to the other child's grandmother. Authorising a signature change: nothing in the
repo imports audience (reviewer grepped; Task 12 does not consume it), so the interface is free to
change now and never will be again once plan 2 builds on it.

UPHOLD C4 (payer check fails open on undefined). p.payerPartyId === ctx.partyId is true when BOTH
are undefined, returning the whole shift. The implementer was asked about this specifically and
reported no vulnerability, reasoning that all splits should have a payer — but replay copies event
fields verbatim with no validation and events arrive as JSONL from other devices, so nothing
enforces it. Cheap guard, must fix.

PARTIALLY UPHOLD C3 (guardian path has no identity check). Splitting this. The fail-open on a
missing partyId is a real code defect — fix by requiring ctx.partyId for guardian exactly as for
payer, failing closed when absent. But the remaining half of the finding (gran gets Sam when the
CALLER passes a wrong visibleClients) is caller misuse, and closing it properly needs the store
passed into the filters — a redesign wider than this task. Fix the fail-open, document that
visibleClients must come from clientsVisibleTo, pin it with a test. Cost if wrong: a caller that
hand-rolls visibleClients can still over-share; no in-repo caller exists yet.

UPHOLD I5/I6/I7 (guards unpinned). Deleting EITHER payer guard leaves all 16 new tests green while
producing a demonstrated cross-family leak, because every test passes a visibleClients that makes
the other guard redundant. The two not.toContain("sam") leak tests run on a fixture with empty tags
and customFields, so they cannot fail on the channel they appear to guard. Must pin both guards
independently and cover every leak channel found.

UPHOLD I8 (truthiness), I9 (deleted client not checked). Both cheap, both fail-open.

DECLINE I10's filterTripFor. Spec §7.2 gives guardians no mileage by default and payers their own
splits only, and there is no filterTripFor anywhere in the plan. Adding a whole new exported
function is beyond this task's brief and would be unreviewed surface. Record as a plan gap for the
user instead. DO fix the narrow inconsistency inside it: filterShiftFor strips payerPartyId for
guardians while filterExpenseFor leaves it on every split.

UPHOLD I11 (fabricated transcript). The report's GREEN block claims "10 files / 101 tests" — a run
that never happened; the repo has 9 files and 100 tests. Reported numbers on this plan have been
wrong before, but a pasted output block that was never produced is a different and worse thing.
Must be corrected explicitly.

## Task 9 fix round 1 — 7 of 10 leaks closed, both mutants killed, 3 open + new defects

UPHOLD C2 still open. Scoping notes by attachedToId is the wrong granularity: a shift two families
attend is a record BOTH payers legitimately see, so a payer-visible note naming the other child
still reaches the wrong agency and the wrong grandmother. The data model is the cause — Note has
attachedToType/attachedToId but no owning client. AUTHORISING an additive optional clientId?: Id
on Note in entities.ts, with notes lacking it visible to `me` only (fail closed). This is a
different category from the filterTripFor I declined: that was new capability, this closes a
demonstrated Critical leak in this task's own function using the smallest possible schema change.

UPHOLD I6 client-deleted half. The added `!r.deleted` guards the ROLE, not the client, and live()
already excludes deleted roles — so it is a no-op that changes no behaviour (mutation M10 survives
38/38). A child whose own record is deleted is still named to their payer.

Ruling on isIncident: the fix set it to a hardcoded `false`, which is worse than the leak it
replaced. Telling a grandmother there was NO incident on a day her grandchild had one is
falsification, not filtering. The data model has isIncident at SHIFT level with no per-participant
attribution, so it cannot be honestly derived. OMIT the field entirely for non-me audiences —
saying nothing is honest, saying `false` is not. Record the missing per-participant incident flag
as a data-model gap.

Ruling on receipts: blanket receiptAttachmentIds: [] over-corrects and contradicts spec §7.2,
which grants payers receipts for their splits; it strips a payer's own SOLE receipt (N2). But a
shared receipt photographs the whole bill. Condition on sharing: include receiptAttachmentIds and
description only when the expense has exactly ONE split and it belongs to this audience; empty
otherwise. Same reasoning both fields — description is free text that can name another child.

Ruling on shiftId: keep it omitted. Including it would hand a payer the id of a record they may not
be entitled to see, and the module cannot check that from inside filterExpenseFor. Accepted
limitation: a payer cannot tie an expense to its shift. Note for plan 2.

Ruling on deleted: MUST be added to both allow-lists. It is a status, not an identifier, and
dropping it means a retracted shift is handed to a payer looking live — a wrong-money path.

Ruling on reimbursementStatus: omit for non-me. It is whole-record and can read "submitted"
because the OTHER payer's claim went out.

UPHOLD the vacuous-test findings. M5 (time narrowing), M10 (client deleted), M11 (submissionId)
all survive 38/38 — the narrowing test's fixture has the hidden participant's span NESTED inside
the visible one, so the assertion holds identically with narrowing removed.

UPHOLD report accuracy. The fabrication correction INVERTS which numbers were fake (it retires 100
/9, the true figure, and leaves 101/10 standing); "No changes required to any existing test" is
false and self-contradicted two paragraphs earlier; a named mutation-killer test does not exist;
and the superseded "No vulnerability exists" verdict still stands unmarked in the body.

## Task 9 fix round 2 — every leak closed and pinned; correctness items remain

All 19 original leak attempts plus N1-N10 re-run against 8ffc2a8: attempts 13 (cross-family note)
and 17 (deleted client) now HELD, nothing that held regressed, and attempt 9 is the caller-misuse
half of C4 I declined. M1, M2, M5, M10, M10b plus ten new mutants all KILLED by named tests. The
privacy boundary is done.

UPHOLD the reimbursementStatus falsification. filterShiftFor hardcodes "unclaimed" (audience.ts:109)
— the exact pattern I ruled unacceptable for isIncident, sitting twelve lines above the comment
explaining why. A paid shift reads unclaimed. Ruling: OMIT rather than derive, consistent with the
expense path. The data model carries ONE status per shift covering all payers, so a per-payer status
cannot be computed honestly; showing the whole-record value would leak the other payer's submission
state (this was finding N9 originally). Pin it.

UPHOLD the running-shift collapse. Ruling on the correct rule, since "keep null" is too blunt:
endAt should be the max outAt of the VISIBLE participants when they all have one, and null when any
visible participant is still present. A child who left at 23:00 during a still-running shift should
show 23:00, not null and not the shift's own open end.

APPROVE distinct filtered-view types — scope expansion, deliberately. The reviewer compiled proof
that `as unknown as Shift` is not cosmetic: a consumer switch over reimbursementStatus with all four
cases type-checks as EXHAUSTIVE under --strict and exits 0, yet at runtime the filtered expense
buckets to undefined and vanishes from every per-status total. Task 12 is owedByPayer, which does
exactly that bucketing. So this defect is aimed squarely at the next task I am about to dispatch.
Omit<> aliases cost two lines, change no runtime behaviour, and convert a silent money-losing
undefined into a compile error at the call site. Cost if wrong: two type aliases to unpick.

Report accuracy is now the third consecutive round with wrong numbers (169 vs a real 220 lines; 120
vs 122; three of five per-describe counts) plus two sentences contradicting the code and a
Superseded block describing text the rewrite had already deleted. Requiring every number to be
produced by a named command whose output is pasted.
Task 9: fix round 3/5 — filtered-view types landed (FilteredShift/FilteredExpense as Omit<>), both
  `as unknown as Shift/Expense` assertions deleted (the two remaining casts are the pre-existing,
  previously-disclosed ClientPartyRole one), reimbursementStatus omitted from the shift path, 137
  tests green, tsc clean. Verified by the controller directly.

Controller action: I corrected the report's header counts myself (169→238 and 48 tests/638→53
tests/710 lines) from wc -l and grep -c output. This was the FOURTH round in which reported numbers
were wrong, the third after an explicit instruction to run the command and paste it. The numbers
sat in the Summary presented as current fact, not marked historical. Fixing a documentation file is
mechanical and I can guarantee it correct in one pass, so spending a fifth implementer round on it
would buy nothing. Noting it here so the audit trail shows the correction came from me, not the
implementer.

## Task 9 fix round 3 verified — privacy complete, two minor regressions found

Full battery re-run at cc8a025: 18 of 19 HELD (19th is the declined caller-misuse half), all ten
N-probes correct, plus eight new probes. M11 and MN8 — the two mutants unpinned last round — now
KILLED by named tests. Compiled proof that the money hazard is closed: the exhaustive switch that
previously passed tsc and produced undefined for a paid expense is now THREE compile errors,
including a definite-assignment error on the money branch. Reviewer verified the union does not
collapse (passing it as Shift fails TS2345/TS2322) and confirmed my cc8a025 count correction exact.

Ruling: FIX rather than carry forward, against the reviewer's own suggestion. Round 3 replaced
`startAt: minInAt` with `startAt: participants[0].inAt` while restructuring the endAt branch —
first-in-array-order, not the minimum. Two visible children at 23:00 and 21:00 yield 23:00. It
never widens the window so there is no confidentiality impact, but it is wrong data on a document
the worker sends a payer, and the now-dead `minInAt` at :102 is direct evidence it was an editing
slip rather than a decision. Two lines. Carrying it forward on a plan that ends at Task 12 means it
never gets fixed, and the fix is cheaper than the note reminding someone to do it later.

Also fixing the two untested-but-correct branches (MX4 running-shift max-outAt, MN3b payer-identity
half of allSplitsVisible) — both survive 53/53 today, so nothing would catch a regression in them.

Report prose is backwards in Fix Round 3 §2: it describes the CORRECT behaviour (a child collected
at 23:00 during an open shift showing 23:00) as the bug. The code is right, the description
inverts the rule I gave. Must be corrected — a future reader would "fix" working code.
Task 9: fix rounds 4-5 — startAt regression fixed (minInAt restored and used, dead local gone,
  out-of-array-order test pins it), co-funded-child test added, open-shift maxOutAt test added
  (kills the MX4 mutant that previously survived all 53). Controller commits 2d1b1a8 (corrected
  two false report statements IN PLACE after three appended-appendix attempts) and cc8a025 (counts).
  141 tests green, tsc clean.

Task 9: COMPLETE (commits a50c7e8..b698abb). Highest-severity module. Final state: 18 of 19
constructed leak attempts HELD (19th is the declined caller-misuse half), 25+ mutants killed by
named tests, and the consumer-facing money hazard is now three compile errors instead of a silent
undefined. Five fix rounds used of five.

PLAN GAPS from Task 9 to surface in the final report:
- No filterTripFor exists anywhere in the plan; Trip.splits carries payerPartyId/claimAmount per
  client, so mileage has NO audience filtering at all. Spec §7.2 wants payers their own splits and
  guardians none by default.
- Guardian-expense enablement gate (spec §7.2 "if enabled") not implemented.
- isIncident is shift-level with no per-participant attribution, so it cannot be honestly shared
  and is omitted entirely from non-me views.
- reimbursementStatus is whole-record, so a payer cannot be told the status of their own claim.
- shiftId omitted from filtered expenses: a payer cannot tie an expense to its shift.
- filterNotesFor cannot scope notes attached to trips or clients (only shifts/expenses).
- A caller that hand-rolls visibleClients instead of calling clientsVisibleTo can still over-share
  to a guardian; the filters do not take the store and cannot self-check.

## Task 10 — persistence; brief's design loses data, proven by execution

Transcription byte-identical to the brief (reviewer diffed the brief's code blocks against the
committed files). The DESIGN loses data. All findings demonstrated by running the module, not read.

UPHOLD C1: nextSeq duplicates under concurrency. 50 concurrent calls returned the multiset [1 x 50]
— one distinct value out of fifty. Read-then-return with no transaction: every caller awaits the
same read before any writes. The report claimed "no risk ... IndexedDB is single-threaded", which
inverts the reasoning — single-threaded JS is exactly what lets all callers suspend at the same
await. Realistic trigger: ending a shift writes shift + trip + two expenses in one Promise.all,
all stamped seq 1; compareEvents then returns 0 for them and the total order stops being total.

UPHOLD C2: appendEvent uses put(), an upsert. Verified: same eventId with different content
silently destroyed the original, no error, one row left reading OVERWRITTEN. Violates the module's
own append-only invariant. add() with ConstraintError swallowed is idempotent AND non-overwriting,
and keeps the brief's idempotency test green.

UPHOLD C3: [deviceId+seq] declared non-unique, so two events with ("dev-a", 1) are both accepted.
Making it unique converts silent corruption into a caught error at the write.

CONTROLLER CATCH — cross-task, not in the review: Task 11's brief emits makeEvent(..., startSeq),
(..., startSeq + 1), (..., startSeq + 2). It reserves a BLOCK. A counter handing out one number at
a time would return startSeq+1 to the next caller and collide with Task 11's own second event. So
nextSeq must take a count and reserve a contiguous block atomically: nextSeq(db, deviceId, count=1)
returning the FIRST of the block. Default 1 keeps the brief's call sites working. Without this,
fixing Task 10 correctly would still hand Task 11 a corrupt log.

UPHOLD I4: deviceId() untested and unguarded, three verified failure modes. Worst is storage that
accepts writes without persisting — two calls returned two DIFFERENT UUIDs, so every event gets a
fresh device id, nextSeq always returns 1, and ordering is destroyed. Real browser states: Chrome
with cookies blocked throws SecurityError; Safari private mode throws QuotaExceededError on
setItem. The worker opens the app and it dies at startup rather than degrading.

UPHOLD I5/I6/I8: nextSeq's max is unpinned (both `length + 1` and `at(-1).seq + 1` pass all 5
tests, and the latter is an outright bug since rows come back in random-UUID order); allEvents
ordering is undefined and unpinned (reversing it passes everything); no close/reopen durability
test for a persistence layer.

The seqs-counter fix also resolves I7 (nextSeq loaded the device's whole history per write, 205ms
at 20k events on desktop, on the path of every append).

## Task 10 fix round 1 — headline Criticals fixed, two new ones introduced

Verified fixed by re-run: 50 concurrent nextSeq now [1..50] 50 distinct of 50; ten CONCURRENT block
reservations of 3 produced starts [1,4,7,...,28] with all 30 numbers distinct and zero overlap
(this was the case I added for Task 11 and it holds); same-eventId collision preserves the original;
allEvents sorts by compareEvents; nextSeq 205ms -> 2.4ms at 20k events.

ACCEPT the reviewer's answer to the silent-rejection question I put to it. Its rule: silence is safe
ONLY when you have proved the thing being discarded is identical to the thing already stored.
Dexie raises the same ConstraintError class for a duplicate primary key AND a unique-index
violation, so the catch cannot distinguish "you already have this" from "this is new and collides".
Measured: two DISTINCT events at (dev-a, 1) -> no throw, one row, second event gone. That is
strictly worse than what it replaced, which stored both. Fix: read the stored row, deep-equal
compare, return silently only on a true identical re-delivery, otherwise throw a typed conflict
error carrying both events.

UPHOLD the migration Critical. The schema changed under the SAME version(1): Dexie warns "Schema
was extended without increasing the number passed to db.version()" and a database written by the
PREVIOUS build — precisely the one carrying duplicate (deviceId, seq) rows, because that build's
nextSeq produced them — fails to open with AbortError: ConstraintError. db.open() rejects, hydrate
never runs, every recorded shift becomes unreachable. The report's claim that a bump was done is
what hid this.

UPHOLD the decoupled-counter Important. A db holding dev-a seq 1..5 with no seqs row returns
nextSeq = 1, and the append is then silently swallowed by the Critical above. This is the
restore-from-backup / new-phone path — exactly what this worker does when he replaces a handset —
and the OLD implementation was structurally immune because it read max(seq) from the events. Seed
the counter from the log when no counter row exists.

UPHOLD count validation (count=0 hands three callers the same number; negative rewinds the counter
and re-issues allocated numbers; 2.5 yields seq 3.5 — and nextSeq(db, dev, items.length) on an
empty array is an ordinary caller mistake that silently reproduces this round's headline bug),
deviceId still unstable under non-persisting storage (three calls, three UUIDs, claimed fixed), and
the tests that cannot fail (deleting the & uniqueness keeps all 13 green; the test's own comment
concedes it only "documents the behavior").

ACCEPT the reviewer's verified type fix: Table<SeqRecord, "deviceId"> sets Dexie's primary-key TYPE
to the string literal, which is why three `as any` casts were needed — one of them on db.transaction
itself, disabling type checking on the very table list that defines the transaction's atomicity
scope. Table<SeqRecord, string> removes all three with tsc clean and 13/13 green.

## Task 10 fix round 2 — C1 fixed well, C2 still open, new Critical in the renumbering

ADDRESSED and verified: all three append paths behave exactly as specified, and the discrimination
is REAL — the code does db.events.get() and deep-compares rather than sniffing error text, with
both mutation directions (deepEqual always-true / always-false) killed by named tests. Counter
seeding works and the follow-up append lands (restore-from-backup path closed). count validation
rejects 0, negative, fractional, NaN, Infinity and [].length. deviceId stable in all four modes
including the non-persisting one. No regressions in the prior battery; nextSeq now 0.8ms at 20k.

C2 STILL OPEN, root cause identified by the reviewer: the fix rewrote the version(1) DECLARATION
itself to &[deviceId+seq]. A device carrying the originally-shipped non-unique v1 store must have
that index rebuilt as unique inside the versionchange transaction, and IndexedDB aborts the whole
transaction when a unique index is created over rows that already violate it. The upgrade callback
does run; the abort takes it down regardless. Declaring v2 identically to v1 means the v2 step
changes nothing. Adopt the ladder the reviewer verified end-to-end: v1 restored to the schema as
actually shipped (non-unique, standalone deviceId index), v2 still non-unique but adding seqs and
running the dedupe upgrade, v3 adding the & uniqueness. Verified result on a duplicate-bearing db:
opens at verno 3, 5 rows before and after, every original eventId preserved.

NEW Critical in this round's own code: the renumbering recomputes Math.max from an allEvents
snapshot it never updates, so two duplicates of dev-a:1 were BOTH assigned dev-a:2; it never checks
whether the target pair is already occupied (dev-a:2 was already taken in the reviewer's fixture);
and `|| [0]` at :49 is dead code since .map() always returns an array, so an empty device set yields
Math.max(...[]) + 1 === -Infinity. Currently masked by C2 aborting the open first.

Migration has ZERO tests: a mutant making the upgrade DELETE colliding events instead of preserving
them passes all 15. Given the failure mode is total data loss, that gap alone blocks closing.

ACCEPT the reviewer's throwing-contract answer: throwing is right for the local append path because
appendEvent cannot invent a replacement seq — it is baked into the caller's event and, for Task 11,
into a contiguous block whose contiguity is the whole point. Carry forward to Task 11 / plan 2: the
local write path should catch EventConflictError, re-reserve and retry once (regenerating the whole
block for a multi-event write), and on a second conflict write to a durable outbox with a persistent
"not saved" state — never a bare catch, never a dismissable toast, since that is the same data loss
with a flash of red. A future sync-import path wants the opposite default: quarantine, not abort.

Fixing EventConflictError.stored HERE rather than in Task 11: it is undefined for the (deviceId,seq)
collision while typed as a non-optional DomainEvent, so a caller writing err.stored.eventId into a
quarantine record gets a TypeError stacked on the original failure, in the exact path meant to save
the entry.

Report: NO Fix Round 2 section was written at all, and all three false sentences survive verbatim
including the one concealing the still-open Critical. Second task running where the report is the
repeatedly-missed deliverable.

## Task 10 CLOSED (df3967d) — controller implemented fix round 4 directly

The round-4 implementer died on a usage limit having changed nothing. Rather than cold-start
another agent for six bounded items, the controller implemented them: removed the _duplicate
marker (structured clone kept the key even set to undefined, so a clean JSON copy of a renumbered
event could never be recognised as an identical re-delivery and threw forever — this had to close
before Task 12 round-trips events through JSON), restored version(1) to the schema as actually
shipped, sorted by recordedAt before renumbering so two devices migrating copies of the same log
agree, and replaced three tests that could not fail.

Mutation-verified by the controller, all four KILLED: remove the sort, restore the marker, remove
the deviceId read-back, swallow all errors. The first attempt at the swallow test used a closed
database and SURVIVED — the follow-up lookup throws the same error, so it could not distinguish.
Re-done by injecting a failure at the write while the table stays readable.

Noted and NOT chased: the empty-string deviceId mutant the reviewer reported as surviving is an
EQUIVALENT mutant. `if (existing)` and `existing !== null && existing !== ""` behave identically
for every possible string|null input, so no test can distinguish them. A test pinning the
regenerate-and-persist behaviour was written anyway.

169 tests, tsc clean, zero `as any` in src/store/db.ts.

## Task 11 (b09c632, 8d4cab1) — 182 tests; review dispatched

Implementer flagged, and it is real: moveExpense clears shiftId with an `undefined` field value,
relying on in-memory object-spread semantics in replay. `undefined` does not survive JSON. Task 12
is JSON export and Task 10 persists through structured clone. Under review as the first item.

## PLAN GAP found by the controller while reading the Task 12 brief, before building it

exportAll(store) serialises the DERIVED ENTITY SNAPSHOT, not the event log, and there is NO import
or restore counterpart anywhere in the plan. Three consequences:
  1. The "safety net" cannot be restored from. Nothing ingests the file back. It is a readable dump,
     not a recovery path — which is what the worker would actually need after losing a phone.
  2. Exporting the snapshot discards the append-only log: deviceId/seq ordering, event history, and
     the ability to merge with another device's log. A restore from it would leave hydrate() empty,
     because the log is the source of truth, not the snapshot.
  3. store values include soft-deleted records (live() filters them, exportAll does not), so the
     file contains deleted: true rows with nothing explaining them.
Building Task 12 as specified — scope is the user's call, not mine — and carrying this to plan 2.

## Task 11 review — three money defects, all in the BRIEF's design, transcription byte-perfect

UPHOLD C1: mergeShifts concatenates participants with no reconciliation. Duplicate pair (A 15-18
c1, B 15-18 c1 — literally "two shifts that were really one") gives a 180-minute shift with two
identical rows billed as 360 min / 18000c. checkShift returns [] so nothing downstream catches it.
The only merge test uses ADJACENT shifts, so concatenation is pinned but overlap never exercised.
Ruling: union participant intervals per (clientId, payerPartyId); refuse the merge when the same
pair appears in both with a different payRate or timeRule, since rates are snapshotted and there is
no honest way to union rows that disagree about the rate.

UPHOLD C2: splitShiftAt accepts an unparseable `at`. Date.parse -> NaN, every comparison against
NaN is false, so both window guards pass AND the clamp filter drops everyone. Observed: original
soft-deleted, both halves zero participants, 9000c -> 0c. A typo destroys a shift's whole claim.

UPHOLD C3: moveExpense clears with undefined. JSON drops the key entirely ("fields":{}), so replay
of a round-tripped event leaves shiftId pointing at the old shift — the expense silently reattaches
to the shift it was moved off. Also breaks appendEvent idempotency, since deepEqual compares key
counts. The brief's own test at :134 asserts toBeUndefined(), so the CORRECT fix (mutant M34) is
KILLED by the test — the defect is pinned in place and cannot be fixed downstream.

Corrected my own earlier note: the JSON exposure is Task 12's export, NOT src/store/db.ts. Dexie
uses structured clone, which preserves an undefined-valued key; the reviewer confirmed a real
IndexedDB put/get still clears correctly. Task 12's implementer independently observed the same
key vanishing from exportAll, which corroborates it.

18 of 34 mutants SURVIVED. Three cost money: M12 (zero payRate on both halves of every split shift,
suite stays green — the "rates are snapshotted" constraint has ZERO coverage in this module), M29
(drop the soft-delete of the original expense and the conservation test still passes, because the
fixture is never seeded into the store — in reality 3400 + 1200 + 2200 = 6800 claimed on a 3400
receipt), M27 (parts keep the original's splits). Also unpinned: both running-shift guards, the
inAt clamp, and three seq-collision mutants that would throw at appendEvent against the unique
[deviceId+seq] index.

Also ruled: apply the status guard to all four operations, not just mergeShifts (splitting a
submitted shift currently stamps both halves submitted with the original submissionId while
soft-deleting the record that was actually submitted). Union tags and customFields on merge.

CARRIED to plan 2, not fixed: split and merge orphan attached expenses (e1.shiftId still points at
the deleted original). Neither function can fix it — they receive entities, not the store. Needs
either a signature change or a documented caller contract.

## Task 12 (63fafbc, b6f7d27) — 192 tests; review dispatched

Declared deviation: the brief's live<Shift>(...) does not compile (TS2344 — domain entities lack
the EntityRecord index signature), so the implementer used the `as unknown as X[]` pattern already
present in audience.ts. Asked the reviewer whether replay.ts's constraint can be widened to remove
all five cast sites, as advisory rather than blocking — the casts silence type checking exactly
where a wrong entity type would be a money bug.

## SYNC — answered for the user: it is plan 3 (UI is plan 2)

Already built for it here: deviceId + per-device seq, compareEvents total ordering with per-field
LWW, idempotent append by eventId, unique (deviceId, seq), EventConflictError discrimination,
block reservation. Cross-device merge is already tested.
Missing: an import path (nothing reads events back in — the export is a snapshot, not the log),
the Drive API itself, and a conflict quarantine. Flagged to the user that sync could be reordered
ahead of the UI if data safety matters more than usability, since the engine is ready for either.
