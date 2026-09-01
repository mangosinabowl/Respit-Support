# Task 12 Report: The Owed query and full backup

## What I implemented

- `src/domain/queries.ts` — `OwedRow` interface and `owedByPayer(store: EntityStore): OwedRow[]`. Walks live shifts, expenses and trips, buckets each by `reimbursementStatus` (`unclaimed` / `submitted` / `paid`; `notReimbursable` maps to no bucket), computes shift time cost via `allocateTime(shift.participants)`, and accumulates into one row per `payerPartyId`, sorted by `payerPartyId`.
- `src/domain/backup.ts` — `exportAll(store: EntityStore): string`. Builds `{ version: 1, exportedAt: nowInstant(), ...one array per entity type }` and returns `JSON.stringify(payload, null, 2)`.
- `tests/domain/queries.test.ts` and `tests/domain/backup.test.ts` — the brief's test files, verbatim, no edits.

Both files otherwise match the brief's code exactly, with one necessary change described below.

## Deviation from "verbatim" — implementation, not test fixtures

The brief's test fixtures type-checked and ran with no changes. The brief's **implementation** for `queries.ts` did not type-check as given. I want to be fully transparent that this falls outside the letter of the instruction ("if the brief's test fixtures do not type-check, change only the fixtures") — it was the implementation, not the fixtures, that failed. I judged the underlying intent (verbatim behavior, minimal necessary fix, document clearly) still applied, and here is exactly what happened and why.

The brief calls `live<Shift>(store, "shift")`, `live<Expense>(store, "expense")`, `live<Trip>(store, "trip")` — explicitly parameterizing the generic `live<T extends EntityRecord>`. `EntityRecord` (in `src/domain/replay.ts`) requires a `[key: string]: unknown` index signature; `Shift`, `Expense` and `Trip` (in `src/domain/entities.ts`, extending `BaseRecord`) declare no such index signature. Explicitly supplying a type argument to a generic checks the argument against the constraint via assignability, which is stricter about index signatures than a type assertion — so this fails:

```
src/domain/queries.ts(30,28): error TS2344: Type 'Shift' does not satisfy the constraint 'EntityRecord'.
  Index signature for type 'string' is missing in type 'Shift'.
src/domain/queries.ts(38,30): error TS2344: Type 'Expense' does not satisfy the constraint 'EntityRecord'.
  Index signature for type 'string' is missing in type 'Expense'.
src/domain/queries.ts(44,27): error TS2344: Type 'Trip' does not satisfy the constraint 'EntityRecord'.
  Index signature for type 'string' is missing in type 'Trip'.
```

This is not a new problem I introduced — `src/domain/audience.ts` already hits the identical issue and already works around it, twice: `live(store, "role") as unknown as ClientPartyRole[]`. I applied the exact same, already-established pattern at the three call sites in `queries.ts`:

```ts
for (const shift of live(store, "shift") as unknown as Shift[]) {
...
for (const expense of live(store, "expense") as unknown as Expense[]) {
...
for (const trip of live(store, "trip") as unknown as Trip[]) {
```

This is a compile-time-only change. `live`'s generic parameter has no runtime effect (`live`'s own body does `... as T[]`, itself just a cast); the underlying call, the filter, and the returned array are identical either way. No logic, bucketing, or arithmetic in the brief's `owedByPayer` was touched. I did not touch `replay.ts` or `entities.ts` (e.g. by adding an index signature to `BaseRecord`) — that would fix the root cause more broadly but has a much larger blast radius across files outside my scope, including files the concurrently-reviewing agent is reading.

`src/domain/backup.ts` required no changes and type-checks and runs exactly as specified.

## The five self-review checks (actual observed values)

For all five I wrote a temporary Vitest file, `tests/domain/_selfcheck_temp.test.ts`, ran it, captured real console output, then deleted it (`git status --short` after deletion shows no stray files — confirmed below). Commands and output are pasted verbatim from the actual run (redirected to a file and cat'd back, so nothing here is retyped from memory).

**1. Money separation.** Same payer (`p1`) with an unclaimed, a submitted and a paid expense (500 / 700 / 900 cents), plus a decoy expense for a different payer (`p2`, 111 cents unclaimed):
```
CHECK1_ROWS [{"payerPartyId":"p1","unclaimed":500,"submitted":700,"paid":900},{"payerPartyId":"p2","unclaimed":111,"submitted":0,"paid":0}]
```
`p1` shows 500/700/900 in the correct columns, none doubled into another bucket; `p2` is unaffected by `p1`'s figures. Matches the brief's own "separates unclaimed, submitted and paid" test, confirmed independently with different numbers and an added decoy payer.

**2. Soft-deleted records.** A soft-deleted shift (`s1`, would have been 6000 cents unclaimed at 6000/hr for 2 hours) and a soft-deleted expense (`e1`, 250 cents), plus one live control expense for the same payer (`e2`, 42 cents):
```
CHECK2_ROWS [{"payerPartyId":"p1","unclaimed":42,"submitted":0,"paid":0}]
CHECK2_RAW_SHIFT_S1 {"id":"s1", ... ,"deleted":true}
CHECK2_RAW_EXPENSE_E1 {"id":"e1", ... ,"deleted":true}
```
`owedByPayer` returns only the 42-cent live expense — the deleted shift's 6000 and the deleted expense's 250 are both excluded, and correctly so (a deleted shift/expense is not owed). The raw store still holds both deleted records (confirming `replay()` never discards them; `owedByPayer`'s use of `live()` is what filters them). **No bug found: deleted records are correctly excluded.**

**3. Multi-payer shift.** Two scenarios:
- `fullPerPayer`, two participants/two payers, both present the full 2-hour window, rates 3000 and 5000 cents/hr:
  ```
  CHECK3_FULLPERPAYER [{"payerPartyId":"p1","unclaimed":6000,...},{"payerPartyId":"p2","unclaimed":10000,...}]
  ```
  `p1` = 2h × 3000 = 6000, `p2` = 2h × 5000 = 10000 — each payer billed independently in full, as `fullPerPayer` intends (more children, not a group discount).
- `splitEvenly`, two participants/two payers sharing the identical 3-hour window at the same 4000 cents/hr rate:
  ```
  CHECK3_SPLITEVENLY [{"payerPartyId":"pA","unclaimed":6000,...},{"payerPartyId":"pB","unclaimed":6000,...}] sumSplit= 12000 soloTotal= 12000
  ```
  Each payer is billed 6000 (half of the 3-hour segment each), and the two parts sum exactly to 12000 — the same total a single occupant would have cost for that 3-hour window at that rate. Parts are attributed per payer and sum back to the shift's time-cost total, with no double counting and no leakage between payers.

**4. Export round-trip.** Built a store with a `party`, a `client`, a live shift `s1`, a soft-deleted shift `s2`, and (deliberately) a later event setting `s1.submissionId = undefined`:
```
CHECK4_TOPLEVEL_KEYS ["version","exportedAt","party","client","role","shift","expense","trip","note","tag","preset","submission","attachment","inboxItem"]
CHECK4_VERSION 1 EXPORTED_AT 2026-09-01T19:59:30.733Z
CHECK4_RAW_STORE_SHIFT_S1_HAS_SUBMISSIONID_KEY true
CHECK4_EXPORTED_SHIFT_S1_HAS_SUBMISSIONID_KEY false
CHECK4_PARTY_EQUAL true
CHECK4_CLIENT_EQUAL true
CHECK4_SHIFT_COUNT 2
CHECK4_S2_PRESENT_AND_DELETED {"id":"s2", ... ,"deleted":true}
```
- Parses without throwing; every one of the 12 entity types appears as a top-level key (even ones with zero records, as empty arrays), plus `version` and `exportedAt`.
- `party` and `client` round-trip exactly field-for-field (`JSON.stringify` equality against the live store values).
- Soft-deleted shift `s2` **does** appear in the export, with `deleted: true` intact — nothing is silently dropped for being deleted.
- **What does not survive the round-trip:** `s1.submissionId` was set to `undefined` via a later event. `Object.prototype.hasOwnProperty` confirms the in-memory store record still carries the `submissionId` *key* (with value `undefined`) — but after `exportAll` + `JSON.parse`, that key is gone entirely from the exported shift object (`hasOwnProperty` returns `false`). This is plain `JSON.stringify` behavior (it omits object properties whose value is `undefined`), not a bug in `exportAll`'s logic, but it is a real, silent loss: a field that was explicitly cleared with `undefined` instead of `null` disappears from the backup with no trace, rather than exporting as `null` or throwing. This is the exact same class of issue the project's own `progress.md` already flags for Task 11's `moveExpense` (which clears `shiftId` via `undefined`, relying on in-memory object-spread) — `moveExpense` output would hit exactly this silent-drop behavior if ever exported. `replay.ts`'s own docstring already warns about this for the JSONL event-log boundary ("events must clear a field by setting it to null, never undefined"); this shows the identical risk recurs a second time at the `exportAll` backup boundary for any record already holding an `undefined`-valued field, however it got there.
- I am not proposing a design change here — this is exactly what the task asked me to observe and report, not fix.

**5. Empty store.**
```
CHECK5_THREW_OWED false OWED_RESULT []
CHECK5_THREW_EXPORT false EXPORT_KEYS ["version","exportedAt","party","client","role","shift","expense","trip","note","tag","preset","submission","attachment","inboxItem"]
```
`owedByPayer(replay([]))` returns `[]` without throwing. `exportAll(replay([]))` parses to an object with `version`, `exportedAt`, and all 12 entity-type keys (each an empty array) without throwing.

## What the export does and does not preserve

- **Preserves:** every entity type (even empty ones, as `[]`), all plain-data fields (strings, numbers, booleans, arrays, nested objects), and — confirmed above — soft-deleted records, complete with their `deleted: true` flag. `version` and `exportedAt` are added at the top level.
- **Does not preserve:** any field whose in-memory value is `undefined` (the key vanishes silently — see Check 4 above). Also, by design (per the brief and the known plan-level gap already recorded in `progress.md` before this task was built, which I was told not to try to fix): `exportAll` serializes the **derived entity snapshot**, not the event log — no `deviceId`/`seq` ordering, no event history, and no way to merge with another device's log is present in the export, and there is no import/restore counterpart anywhere in this plan. A restore from this file alone cannot repopulate `hydrate()`, since the log (not the snapshot) is this system's source of truth. I did not change this design; I confirmed it by reading `backup.ts` and by the round-trip test above (the export's shape is exactly `{version, exportedAt, <entityType>: EntityRecord[]}`, with no `events` array anywhere in it).

## What I tested and the results

- `npm test` (`tsc --noEmit && vitest run`) run before implementation (RED), after the brief's verbatim implementation (still RED, different reason), after the minimal fix (GREEN), and once more after committing (GREEN, final confirmation).
- A temporary self-check Vitest file exercising the five required scenarios above with real assertions and `console.log` output, then deleted (not part of the commit).
- Definition-of-done checks: `git ls-files | grep -iE "\.pdf$|^Rory/"` → no output (pass). `grep -rnE "from [\"']dexie[\"']|\bfetch\(|document\.|window\." src/domain/` → no output (pass, no forbidden imports/DOM globals in `src/domain/`).
- Confirmed `src/domain/operations.ts` and `tests/domain/operations.test.ts` are byte-for-byte unchanged since `8d4cab1` (`git diff --stat 8d4cab1 -- src/domain/operations.ts tests/domain/operations.test.ts` produced empty output) — the concurrently-reviewed module was not touched.

## TDD Evidence

**RED** — command: `npm test` (test files created, implementation files did not yet exist)
```
> respite-support@0.0.0 test
> tsc --noEmit && vitest run

tests/domain/backup.test.ts(2,27): error TS2307: Cannot find module '../../src/domain/backup' or its corresponding type declarations.
tests/domain/queries.test.ts(2,29): error TS2307: Cannot find module '../../src/domain/queries' or its corresponding type declarations.
tests/domain/queries.test.ts(44,36): error TS7006: Parameter 'r' implicitly has an 'any' type.
```
Expected failure: both new modules did not yet exist. (The extra TS7006 is a side effect of `owedByPayer` being implicitly `any` while its module is unresolved — it depends on nothing I control and was expected to disappear once the module resolved, which it did.)

**Intermediate — brief's verbatim `queries.ts`, still red, different reason:**
```
src/domain/queries.ts(30,28): error TS2344: Type 'Shift' does not satisfy the constraint 'EntityRecord'.
  Index signature for type 'string' is missing in type 'Shift'.
src/domain/queries.ts(38,30): error TS2344: Type 'Expense' does not satisfy the constraint 'EntityRecord'.
  Index signature for type 'string' is missing in type 'Expense'.
src/domain/queries.ts(44,27): error TS2344: Type 'Trip' does not satisfy the constraint 'EntityRecord'.
  Index signature for type 'string' is missing in type 'Trip'.
```

**GREEN** — command: `npm test`, after the three `live(...) as unknown as X[]` call-site fixes:
```
> respite-support@0.0.0 test
> tsc --noEmit && vitest run


 RUN  v4.1.11 C:/Users/aandr/OneDrive/Documentos/Respit Support


 Test Files  13 passed (13)
      Tests  192 passed (192)
   Start at  12:56:05
   Duration  1.86s (transform 3.69s, setup 0ms, import 5.64s, tests 907ms, environment 5ms)
```
192 = 182 previously-passing tests + 10 new (6 in `queries.test.ts`, 4 in `backup.test.ts`). Re-confirmed after committing:
```
 Test Files  13 passed (13)
      Tests  192 passed (192)
   Start at  13:02:57
   Duration  1.73s (transform 2.94s, setup 0ms, import 5.08s, tests 1.14s, environment 4ms)
```

## Files changed

- `src/domain/queries.ts` (new)
- `src/domain/backup.ts` (new)
- `tests/domain/queries.test.ts` (new)
- `tests/domain/backup.test.ts` (new)

No other files touched. `src/domain/operations.ts` and `tests/domain/operations.test.ts` were not opened for editing (only read, transitively, via `grep`/`cat` while checking existing `live()` call patterns and repo conventions) and are confirmed unchanged. `.superpowers/sdd/2026-08-31-core-engine/progress.md` had a pre-existing uncommitted modification (from the controller, present before I started) which I deliberately left untouched and unstaged — I committed only the four files above, not `git add -A`, following the narrower-commit convention already established by this repo's own history (`b09c632`, a `feat:` commit, touched only its own two files; the unrelated `progress.md`/report bookkeeping happened in separate `docs:` commits). `tests/domain/_selfcheck_temp.test.ts` was created for the self-review checks and deleted before committing; `git status --short` afterward showed only the four intended files.

## Self-review findings

Read the diff (both new files, ~64 lines total) with fresh eyes:

- `owedByPayer`'s three loops (shift/expense/trip) are structurally identical: bucket the status, skip if not owed, accumulate into `rows` keyed by payer. No duplicated logic beyond what the brief itself specifies; nothing overbuilt.
- The `add` closure correctly initializes a fresh row (`unclaimed/submitted/paid` all 0) only once per payer via `??`, then mutates the specific bucket — confirmed by Check 1 that this does not cross-contaminate buckets or payers.
- `owedByPayer` uses `live()` (deleted-filtering) for all three entity types, so soft-deleted shifts, expenses and trips are uniformly excluded — confirmed for shift and expense in Check 2 (the brief's own tests only covered expense; I additionally exercised shift).
- `bucketOf` cleanly excludes `notReimbursable` (and any unrecognized status) by returning `null`, which every loop checks before accumulating — matches the brief's comment and the brief's own "excludes expenses marked not reimbursable" test.
- `exportAll` iterates `Object.entries(store)`, i.e. every entity type's raw `Map` (not `live()`-filtered), so soft-deleted records are included by construction — confirmed in Check 4.
- Rates are never recomputed anywhere in either file — `owedByPayer` only sums amounts already computed by `allocateTime` (which itself snapshots `payRate` per participant) or already-stored split/claim amounts; `exportAll` does no arithmetic at all.
- Money stayed integer cents throughout; `allocateTime` (unchanged, pre-existing) rounds internally, and `owedByPayer` only ever adds integers.
- The one deviation (three `live<X>(...)` call sites changed to `live(...) as unknown as X[]`) is documented above, is compile-time-only, mirrors an existing pattern already in the codebase (`audience.ts`), and was verified not to change behavior (all brief tests plus my own additional scenarios pass with identical figures either way — the constraint-check failure occurs before any code ever runs).

## Issues or concerns

- **The implementation deviation above.** I did not have explicit authorization to modify implementation code (only test fixtures), but the brief's `queries.ts` as given does not compile under this project's `tsconfig.json` (`strict: true`), and shipping code that fails `tsc --noEmit` would fail `npm test` and the plan's own Definition of Done. I made the smallest possible fix, mirroring an established in-repo pattern, with no behavioral change. Flagging this clearly for the reviewer rather than presenting it as if the brief compiled unmodified.
- **`undefined`-valued fields silently vanish from `exportAll`'s output** (Check 4). Not a bug in this task's code — inherent `JSON.stringify` behavior — but a real, silent-loss risk for any record carrying a field cleared via `undefined` rather than `null` (the project already has at least one such code path: Task 11's `moveExpense`, per `progress.md`). Reporting only, per the task's instruction not to change the design.
- The export/backup design gap (snapshot, not event log; no import counterpart) is the known, already-recorded plan-level limitation — confirmed present exactly as described, not altered.
