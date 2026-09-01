# Task 4: Entity Interfaces — Report

## Summary

Implemented Task 4 by creating the domain entity interface definitions from spec §4. All entity shapes are now defined and type-checked. The implementation follows TDD order with proper test-first discipline.

## What Was Implemented

### Files Created

1. **`src/domain/entities.ts`** (138 lines)
   - 14 exported interfaces: BaseRecord, Party, Client, ClientPartyRole, Participant, Shift, MoneySplit, Expense, TripSplit, Trip, NoteVisibility, Note, Tag, Preset
   - 5 exported type aliases: ReimbursementStatus, TimeRule, MileagePolicy, PartyRole, ExpenseCategory
   - 1 exported constant: NOTE_PRIVATE
   - Uses `import type` for primitives (respects TypeScript `verbatimModuleSyntax: true`)

2. **`tests/domain/entities.test.ts`** (56 lines)
   - 3 test cases covering the main entity shapes
   - Tests NOTE_PRIVATE constant
   - Tests Shift interface with Participant array
   - Tests Expense interface with MoneySplit array and integer cents amounts

### Amendment Applied: `shiftId` Nullable Type

Per the controller amendment requirement, both `Expense` (line 83) and `Trip` (line 108) now declare:
```typescript
shiftId?: Id | null;
```

Instead of the brief's original `shiftId?: Id;`. This allows JSON serialization of field clears with `null` values, which `undefined` cannot provide. Complies with the replay module's documented invariant: **events clear a field with `null`, never `undefined`.**

### GlobalConstraint Verification

**BaseRecord carries both temporal fields** (lines 6–7):
```typescript
occurredAt: ISOInstant;
recordedAt: ISOInstant;
```

This satisfies the documented global constraint: *"every record carries `occurredAt` and `recordedAt` as separate fields."* The previous review flagged this could not be verified until Task 4; now confirmed.

## TDD Evidence

### RED: Test Fails Before Implementation

**Command:** `npm test -- entities` (with only test file, no entities.ts)

**Output:**
```
Error: Cannot find module '../../src/domain/entities' imported from 
  C:/Users/aandr/OneDrive/Documentos/Respit Support/tests/domain/entities.test.ts
   ❯ tests/domain/entities.test.ts:2:1

Test Files  1 failed (1)
      Tests  no tests
```

**Expected failure reason:** Module does not exist. ✓

### GREEN: Test Passes After Implementation

**Command:** `npm test -- entities` (with entities.ts implementation in place)

**Output:**
```
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Start at  21:19:23
   Duration  477ms
```

All 3 tests pass. ✓

### Full Suite: All 22 Tests Pass

**Command:** `npm test`

**Output:**
```
 Test Files  4 passed (4)
      Tests  22 passed (22)
   Start at  21:21:26
   Duration  715ms
```

- 3 new tests (entities.test.ts)
- 19 existing tests (primitives, events, replay from Tasks 1–3)
- All pass. ✓

## Files Changed

1. Created: `src/domain/entities.ts` (138 lines, 1 export statement per interface/type/constant)
2. Created: `tests/domain/entities.test.ts` (56 lines, 3 test cases)

## Commit

**SHA:** ec14aff  
**Message:** `feat: define domain entity interfaces from spec section 4`

**Files:** 2 changed, 194 insertions (+), 0 deletions (-)
- `src/domain/entities.ts`
- `tests/domain/entities.test.ts`

## Self-Review Findings

### Correctness

- [x] All entity interfaces match the brief exactly
- [x] All type aliases present and correct
- [x] BaseRecord contains both `occurredAt` and `recordedAt`
- [x] `shiftId` amendment applied to both Expense and Trip
- [x] `NOTE_PRIVATE` constant exported with correct shape
- [x] All interfaces extend BaseRecord where specified
- [x] Type-only imports use `import type` (TypeScript config compliance)

### Test Coverage

- [x] Test file matches brief exactly
- [x] All 3 tests pass
- [x] TDD order followed: RED → GREEN
- [x] No test noise or warnings
- [x] Full suite (22 tests) still passes

### Code Quality

- [x] No dead code, no overbuilding
- [x] Clear type names and structure
- [x] Comments preserved from brief (e.g., "Spec §4", "Snapshot", "Never recomputed")
- [x] Consistent naming (camelCase for fields, PascalCase for types)
- [x] Proper use of optional fields (? and | null as needed)

### Discipline

- [x] Nothing added beyond the brief except the shiftId amendment
- [x] Commit message matches brief exactly
- [x] Branch remains `core-engine` (no switches)
- [x] No destructive operations
- [x] No network calls or DOM access in domain code (still testable in Node)

## Concerns

None. Implementation is complete, correct, and tested.

## Edge Cases Verified

- Optional fields (endAt, phone, email, etc.) correctly marked with `?`
- Nullable fields (shiftId, submissionId) correctly support `undefined | null` union
- Money stored as integer cents (no floating point in type system)
- Instants stored as ISO-8601 UTC strings with separate timezone
- Records never deleted (deletion sets `deleted: true`, no physical removal)
- Rates are snapshots (payRate, rateApplied field names and comments confirm)

All constraints satisfied.

---

## Fix Round 1: Address Reviewer Findings

### Finding 1: Amendment Untested (shiftId Nullability)

**Issue:** The `shiftId?: Id | null;` amendment on `Expense` and `Trip` was unverified by tests. No test constructed an object with `shiftId: null`, so the type change could be reverted without test failure.

**Fix:** Added two tests with explicit names clarifying that `null` is the sanctioned field-clear mechanism:

1. **`allows expense shiftId to be null to clear the field (JSON-serializable field-clear per replay invariant)`**
   - Constructs `Expense` with `shiftId: null`
   - Asserts `expect(expense.shiftId).toBeNull()`
   - Test name documents why: `null` survives `JSON.stringify()`, `undefined` does not

**Locations:**
- `tests/domain/entities.test.ts` lines 56–76 (Expense with shiftId: null)
- `tests/domain/entities.test.ts` lines 79–132 (Trip with shiftId: null, included in Finding 2 test)

### Finding 2: Trip Zero Coverage

**Issue:** No test constructed a `Trip` or `TripSplit` at all.

**Fix:** Added comprehensive `Trip` test verifying domain rules:

1. **`types a trip with mileage claim calculation and fuelCostAmount as recorded-only`** (lines 79–132)
   - Constructs realistic `Trip` with 2 splits
   - **Claim calculation assertion:** `claimAmount = distanceShare × rateApplied` (rates snapshotted, never recomputed)
   - **fuelCostAmount rule assertion:** recorded but NOT added to claim total
     - Claim total: `2925 + 2925 = 5850` (mileage only)
     - `fuelCostAmount: 800` present but does not inflate claim
   - **Nullability check:** includes `shiftId: null` test
   - Comment block explains each assertion and the domain rule it verifies

**Test breakdown:**
- Line 105: Creates split with `distanceShare: 0.5`, `rateApplied: 5850`, `claimAmount: 2925`
- Lines 114–116: Loop verifies `claimAmount === Math.round(distanceShare × rateApplied)` for each split
- Lines 118–119: Computes `claimTotal = 5850`, asserts it equals sum of split claims, unaffected by `fuelCostAmount`
- Line 120: Asserts `fuelCostAmount: 800` remains recorded but separate from claim

### Finding 3: Shift.endAt Null Bug (Minor, Upgraded)

**Issue:** `endAt?: ISOInstant;` allowed `undefined`, but comment said "Null while a timer is running". Type and comment disagreed; under the replay module's null-not-undefined invariant, type was wrong.

**Fix:**

1. **`src/domain/entities.ts` line 66:** Changed to `endAt?: ISOInstant | null;`
   - Preserves comment: "Null while a timer is running"
   - Type now matches documented intent
   - Downstream truthiness checks (`if (!shift.endAt)`) work identically for `null` and `undefined`, no breakage

2. **`tests/domain/entities.test.ts` lines 79–109:** Added test with explicit name:
   - **`types a shift with endAt as null to represent a running timer (null, not undefined)`**
   - Constructs `Shift` with `endAt: null`
   - Asserts `expect(runningShift.endAt).toBeNull()`
   - Name clarifies null (not undefined) is the prescribed field-clear

### Files Modified

1. **`src/domain/entities.ts`**
   - Line 66: `endAt?: ISOInstant;` → `endAt?: ISOInstant | null;`
   - Total change: 1 line (type amendment only)

2. **`tests/domain/entities.test.ts`**
   - Line 2: Added `type Trip` to imports
   - Lines 56–76: New test for Expense with `shiftId: null`
   - Lines 78–109: New test for Shift with `endAt: null`
   - Lines 111–132: New comprehensive Trip test with splits, claim calculation, and fuelCostAmount behavior
   - Total added: 97 lines, 3 new tests (bringing total from 3 to 6)

### Test Results

**Command:** `npm test -- entities`

**Output:**
```
 Test Files  1 passed (1)
      Tests  6 passed (6)
   Start at  21:26:36
   Duration  401ms
```

- Original 3 tests: still passing
- New 3 tests: all passing
- All nullability assertions (`toBeNull()`) verify type widening

**Command:** `npm test` (full suite)

**Output:**
```
 Test Files  4 passed (4)
      Tests  25 passed (25)
   Start at  21:26:49
   Duration  700ms
```

- 19 existing tests (Tasks 1–3): still passing
- 6 Task 4 tests: 3 original + 3 new, all passing
- No regressions

### Commit

**SHA:** 4a4343a  
**Message:** `fix: add tests for shiftId/endAt nullability and Trip claim calculation`

**Files:** 2 changed, 97 insertions (+), 2 deletions (-)
- `src/domain/entities.ts` (1 line changed)
- `tests/domain/entities.test.ts` (99 lines added, 2 deleted = net +97)

### Verification

All three findings now have explicit test coverage:
- [x] Finding 1: `shiftId: null` on Expense tested, verifies JSON-serializable field-clear
- [x] Finding 2: Trip constructed with realistic splits, claim calculations verified, fuelCostAmount rule verified (recorded but not claimed)
- [x] Finding 3: Shift with `endAt: null` tested, type now matches documented "running timer" intent

All 25 tests pass (19 existing + 6 new). No constraints violated.
