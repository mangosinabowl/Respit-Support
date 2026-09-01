# Task 7 Implementation Report: Time allocation rules

## Summary

Successfully implemented the `allocateTime` function that converts participant records (who was present, when, for how much pay) into per-payer time claims. The implementation encodes the user's decision that more children never means a cut rate: `fullPerPayer` is the default, where every payer owes the full duration their client was present. The opt-in `splitEvenly` mode divides shared time among participants present during each segment.

## What Was Implemented

### Core Implementation

**File:** `src/domain/timeAllocation.ts`
- Exports `TimeClaim` interface with fields: `clientId`, `payerPartyId`, `minutes`, `amount` (in cents)
- Exports `allocateTime(participants: Participant[]): TimeClaim[]` function
- Logic flow:
  1. Filters participants to those with non-zero duration (inAt < outAt)
  2. Calls `segmentsFor()` to split the shift at every in-time and out-time boundary
  3. For `fullPerPayer` participants, immediately allocates their full presence duration
  4. For `splitEvenly` participants, divides their portion of each segment by the count of people present in that segment
  5. Returns per-payer claims with calculated monetary amounts (minutes / 60 * payRate, rounded to cents)

**File:** `tests/domain/timeAllocation.test.ts`
- Implements 8 required tests from the brief
- Adds 2 additional handover-scenario tests (see below)

### Handover Tests

Beyond the brief's 8 tests, added tests covering the boundary case where one participant's `outAt` equals another's `inAt` (the ordinary handover moment in this job):

1. **"bills each payer exactly their own duration with fullPerPayer when handover occurs"**
   - c1 present 15:00–17:00 (120 minutes), c2 present 17:00–19:00 (120 minutes)
   - Both using `fullPerPayer` (default)
   - Asserts: c1 billed 120 minutes (6000 cents), c2 billed 120 minutes (6000 cents)
   - Verifies no shared time is created at the handover point

2. **"does not create phantom shared segments at handover with splitEvenly"**
   - Same times and sequence, but both participants using `splitEvenly`
   - Asserts: both still receive full 120 minutes each (6000 cents)
   - Confirms that a naive "divide by participant count" would be wrong (would halve both)
   - Proves `segmentsFor` and allocation correctly handle non-overlapping timeframes

## Testing Results

### TDD Evidence: RED (Before Implementation)

Command: `npm test`

```
tests/domain/timeAllocation.test.ts(2,30): error TS2307: Cannot find module '../../src/domain/timeAllocation' or its corresponding type declarations.
tests/domain/timeAllocation.test.ts(21,24): error TS7006: Parameter 'c' implicitly has an 'any' type.
[... additional type errors for all map() calls ...]
```

**Expected failure:** Module did not exist.

### TDD Evidence: GREEN (After Implementation)

Command: `npm test`

```
 RUN  v4.1.11 C:/Users/aandr/OneDrive/Documentos/Respit Support

 Test Files  7 passed (7)
      Tests  54 passed (54)
   Start at  21:55:20
   Duration  1.02s (transform 988ms, setup 0ms, import 1.44s, tests 402ms, environment 1ms)
```

**Breakdown for timeAllocation.test.ts specifically:**

Command: `npm test -- tests/domain/timeAllocation.test.ts`

```
 Test Files  1 passed (1)
      Tests  10 passed (10)
   Start at  21:55:50
   Duration  599ms (transform 61ms, setup 0ms, import 96ms, tests 9ms, environment 1ms)
```

**Test Results:**
- All 8 tests from the brief pass
- Both handover scenario tests pass
- All 44 tests from Tasks 1–6 continue to pass (total 54 tests across 7 test files)

## Files Changed

- **Created:** `src/domain/timeAllocation.ts` (56 lines)
- **Created:** `tests/domain/timeAllocation.test.ts` (94 lines)

## Self-Review Findings

### Completeness
✓ Implementation matches the brief exactly (code verbatim)
✓ All 8 required tests from brief are present and passing
✓ Both handover tests are present and passing
✓ Edge cases handled: empty participant list, zero-duration participants
✓ Type imports use `import type` as required by `verbatimModuleSyntax: true`

### Code Quality
✓ Clear function names and variable names
✓ Proper JSDoc documenting the algorithm and the user's decision
✓ Appropriate use of Map for tracking per-client minutes
✓ Correct rounding of monetary amounts (minutes / 60 * rate, rounded to cents)
✓ No unused variables or dead code

### Discipline
✓ No overbuilding beyond the brief
✓ No restructuring of files
✓ Only what was requested is implemented
✓ Single responsibility: `timeAllocation.ts` handles only allocation logic

### Testing
✓ TDD discipline followed: test written first, confirmed to fail for expected reason
✓ Test output pristine (no warnings, no stray output)
✓ Handover tests verify the critical boundary behavior
✓ All prior tests remain passing

## Issues and Concerns

None. The implementation is complete, correct, and all tests pass.

## Commit

Created commit: `941ff90` with message "feat: allocate shift time per payer, defaulting to no group discount"

---

## Fix Round 1: Address Review Findings

### Finding 1 (Critical) — Accumulate fullPerPayer time instead of overwriting

**Problem:** The original implementation used `minutesByClient.set(p.clientId, ...)` which overwrote minutes instead of accumulating. When the same client appeared twice (e.g., dropped off, returned), the second entry's duration replaced the first, causing incorrect billing. Additionally, the function returned one claim per participant entry instead of one per unique clientId+payerPartyId pair, causing duplicate claims in the output.

**Example failure:** Two `fullPerPayer` stays for c1 (60 min then 120 min) produced two claims showing 120 minutes each, instead of one claim for 180 total.

**Fix applied:**
- Line 32: Changed from `set()` to accumulation: `minutesByClient.set(p.clientId, (minutesByClient.get(p.clientId) ?? 0) + minutesBetween(p.inAt, p.outAt))`
- Lines 47–65: Replaced `present.map()` with an explicit loop that emits one claim per unique (clientId, payerPartyId) pair, preserving order of first appearance

**Tests added to verify the fix:**
1. "accumulates time across multiple stays with fullPerPayer and emits one claim per client" — ensures a client with two stays produces exactly one claim with accumulated minutes
2. "handles a returning client mixed with a different client present throughout" — verifies returning clients don't break other clients' claims

### Finding 2 (Minor) — Pin the splitEvenly rounding choice

**Problem:** The code rounds `splitEvenly` minutes before computing the amount, which is the correct choice (so payer's own arithmetic reconciles). However, this was untested and therefore accidental rather than deliberate.

**Fix applied:**
- Added test "derives amount from rounded minutes so a payer's own arithmetic reconciles"
- Test uses three participants sharing 100 minutes (not evenly divisible):
  - Each receives 33.333... minutes, rounded to 33
  - Amount is calculated from rounded minutes: `Math.round((33 / 60) * 3000)`
  - Verifies that payer can independently verify the claim by multiplying minutes × hourly rate

### Finding 3 (Housekeeping) — Remove stray output file

**Problem:** Test run left `test-output.txt` in the working tree

**Fix applied:**
- Deleted `test-output.txt`
- Added `test-output.txt` to `.gitignore`

### Test Results After Fixes

**Command:** `npm test -- tests/domain/timeAllocation.test.ts`

```
 RUN  v4.1.11 C:/Users/aandr/OneDrive/Documentos/Respit Support

 Test Files  1 passed (1)
      Tests  13 passed (13)
   Start at  22:05:09
   Duration  387ms (transform 64ms, setup 0ms, import 96ms, tests 10ms, environment 1ms)
```

**Full suite:** `npm test`

```
 RUN  v4.1.11 C:/Users/aandr/OneDrive/Documentos/Respit Support

 Test Files  7 passed (7)
      Tests  57 passed (57)
   Start at  22:05:22
   Duration  805ms (transform 640ms, setup 0ms, import 988ms, tests 399ms, environment 2ms)
```

**Summary:**
- 13 tests in timeAllocation (8 from brief + 2 handover + 3 new fix-round tests), all passing
- 57 total tests across all 7 test files (54 prior + 3 new), all passing
- No existing test assertions required modification; all prior tests continue to pass

### Commit for Fix Round 1

Commit `9662c85`: "fix: accumulate fullPerPayer time and emit one claim per client+payer pair"

### Verification

- All prior tests still pass with no assertion changes
- New tests verify both the bug was real and the fix works
- Code review of implementation confirms:
  - Accumulation correctly handles returning clients
  - Pair-deduplication preserves order of first appearance
  - Rounding behavior is now explicitly tested and documented
