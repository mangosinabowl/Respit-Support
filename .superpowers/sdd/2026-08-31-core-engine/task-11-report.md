# Task 11 Report: Split, merge, and move

## What I implemented

Created `src/domain/operations.ts` with four pure functions, exactly as specified in the brief (code used verbatim, no deviation):

- `splitShiftAt(shift, at, deviceId, startSeq)` — splits a shift at an instant into two shifts, clamping each participant's `inAt`/`outAt` to the half they belong to and dropping any participant whose interval collapses to zero. Refuses a split point outside `(startAt, endAt)` and refuses to split a shift still running (`endAt` null/undefined).
- `mergeShifts(a, b, deviceId, startSeq)` — merges two shifts into one spanning both, concatenating participants unmerged. Refuses if either shift has `reimbursementStatus !== "unclaimed"`, or if either is still running.
- `splitExpense(expense, parts, deviceId, startSeq)` — splits an expense into N parts, each carrying its own `splits`/`description`/`totalAmount` but inheriting the original's receipt attachments. Refuses if the parts' `totalAmount`s do not sum exactly to the original.
- `moveExpense(expense, toShiftId, deviceId, startSeq)` — reassigns (or detaches, via `undefined`) an expense's `shiftId`.

All four return event arrays only; none touch the input objects (each builds new objects via spread, never assigns onto the originals).

Also created `tests/domain/operations.test.ts` with the brief's test file, verbatim.

## Changes to brief's test fixtures

None. The test file type-checked and ran as given, no edits needed.

## Sequence numbers consumed per function

- `splitShiftAt`: **3** (`startSeq`, `startSeq+1` for the two new shifts, `startSeq+2` for the deletion of the original).
- `mergeShifts`: **3** (`startSeq` for the merged shift, `startSeq+1` and `startSeq+2` for deleting the two originals).
- `splitExpense`: **`parts.length + 1`** — `startSeq .. startSeq+parts.length-1` for each new expense part, then `startSeq+parts.length` for deleting the original. (For the common 2-part case that's 3; for 3 parts it's 4, etc. Callers must request `nextSeq(db, deviceId, parts.length + 1)`.)
- `moveExpense`: **1** (a single field-update event on the existing expense).

## Self-review checks (actual observed values)

I wrote a scratch TypeScript file (`scratch_selfcheck.ts` in the repo root, run via `npx tsx`, then deleted — not left in the tree) to observe real values, since the brief's own tests use `replay` results rather than asserting non-mutation/exact sums directly.

**1. Non-mutation.** Took `JSON.stringify` snapshots of `shift`, `second` (a merge partner), and `expense` before calling every operation on them (`splitShiftAt`, `mergeShifts`, `splitExpense`, `moveExpense`), then re-stringified after and compared:
```
shift unchanged: true
second unchanged: true
expense unchanged: true
```

**2. Money conservation.** Split an expense with `totalAmount: 1000` into 3 parts that do not divide evenly (334/333/333):
```
parts: [ 334, 333, 333 ]
sum: 1000
```
Sum matches the original exactly (integer cents, no floating point involved — the split amounts were caller-supplied integers, and `splitExpense` only sums and compares them, never divides).

**3. Replay coherence.**
- `splitShiftAt(shift, T(16), "dev-a", 1)` → 3 events; `replay` shows `store.shift.get("s1").deleted === true`, and 2 live shifts (the halves). Matches the brief's own test assertions (`toHaveLength(2)`, spans `[T(15),T(16)]` and `[T(16),T(18)]`).
- `mergeShifts(shift, second, "dev-a", 1)` → 3 events; `replay` shows both `s1` and `s2` marked `deleted: true`, and exactly 1 live shift remaining (the merged one) — nothing orphaned.
- `splitExpense` with 2 parts → 3 events (2 new + 1 deletion), as expected from the `parts.length + 1` formula.
- `moveExpense` → 1 event, as expected.

## What I tested and the results

Ran `npm test` (which runs `tsc --noEmit && vitest run`) twice: once before implementation (RED) and once after (GREEN).

## TDD Evidence

**RED** — command: `npm test`
```
> respite-support@0.0.0 test
> tsc --noEmit && vitest run

tests/domain/operations.test.ts(2,70): error TS2307: Cannot find module '../../src/domain/operations' or its corresponding type declarations.
```
This is the expected failure: the test file imports from `../../src/domain/operations`, which did not yet exist. `tsc --noEmit` fails before vitest even runs, per the project's `npm test` script.

**GREEN** — command: `npm test`
```
> respite-support@0.0.0 test
> tsc --noEmit && vitest run


 RUN  v4.1.11 C:/Users/aandr/OneDrive/Documentos/Respit Support


 Test Files  11 passed (11)
      Tests  182 passed (182)
   Start at  12:46:51
   Duration  1.99s (transform 3.18s, setup 0ms, import 5.03s, tests 984ms, environment 4ms)
```
182 = 169 previously-passing tests + 13 new tests in `operations.test.ts` (4 in `splitShiftAt`, 4 in `mergeShifts`, 3 in `splitExpense`, 2 in `moveExpense`). All 11 test files pass, including the 10 pre-existing ones.

## Files changed

- `src/domain/operations.ts` (new)
- `tests/domain/operations.test.ts` (new)

No other files touched. `scratch_selfcheck.ts` was created transiently in the repo root for the self-review checks above and deleted before committing; `git status --short` after cleanup shows only the two files above as untracked, prior to `git add -A`.

## Self-review findings

Read the diff (both new files, ~215 lines total) with fresh eyes:

- Both functions that "delete" an entity do so via a field-update event (`{ deleted: true, ... }`), never by mutating or removing the original record — consistent with spec §8 append-only requirement.
- `splitShiftAt`'s participant clamp correctly drops a participant whose clamped interval collapses (`outAt <= inAt`), avoiding zero-or-negative-duration participants in either half — this only matters for participants that don't span the split point, which isn't exercised by the brief's test but is safe.
- Rates (`payRate`) are carried through via `...p` spread in the clamp function and via `...shift`/`...a` spreads elsewhere — never recomputed, matching the "rates are snapshotted" constraint.
- `moveExpense` sets `fields: { shiftId: toShiftId }` where `toShiftId` can be `undefined`. This relies on `replay`'s object-spread semantics (`{...current, ...fields}`) — spreading a key explicitly set to `undefined` does override the current value with `undefined` in plain JS object spread, so the brief's own test (`toBeUndefined()`) passes. I noted this is inconsistent with the "clear a field via `null`, never `undefined`" invariant documented in `replay.ts` (which exists because `undefined` doesn't survive JSON serialization when events travel between devices as JSONL) — but this is exactly the code the brief specifies verbatim, and the brief's own test only exercises in-memory `replay`, not a JSON round-trip, so it passes as written. Flagging this as a latent risk for real persistence (a `moveExpense(..., undefined, ...)` event that gets serialized to JSONL and read back would silently fail to clear `shiftId`), not a bug in what I implemented — the brief's code is used as-is per instructions.
- No dead code, no extra abstractions beyond what the brief specifies. Nothing overbuilt.

## Issues or concerns

- The `moveExpense`-with-`undefined` behavior described above is a known gap between this task's code and the project's own documented event-log invariant (in `src/domain/replay.ts`), but it is the brief's verbatim code and its own test passes. Worth a follow-up note if/when a caller wires `moveExpense` to real persistence (`src/store/db.ts`), since events do get JSON-serialized there — `undefined` fields would not round-trip. I did not change the implementation since I was instructed to use the brief's code verbatim, and no test in this task's scope exercises actual JSON serialization.
