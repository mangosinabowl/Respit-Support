# Task 6 Report: Money allocation with an exact-sum guarantee

## What Was Implemented

Created the allocation engine module that splits money between payees with a guaranteed exact-sum property. The implementation produces two functions:

1. **`allocateEvenly(total: Money, payees: Payee[]): MoneySplit[]`**
   - Splits a total amount as evenly as integer cents allow
   - Distributes any remainder one cent at a time from the front
   - Guarantees the result sums exactly to the total

2. **`allocateByWeights(total: Money, payees: Payee[], weights: number[]): MoneySplit[]`**
   - Splits a total in proportion to specified weights
   - Uses largest-remainder apportionment algorithm
   - Guarantees the result sums exactly to the total
   - Falls back to even split when all weights are zero
   - Throws when weights array length doesn't match payees

The core algorithm implements the largest-remainder method:
- Calculate exact shares using floating-point division
- Floor all shares to get integer cents
- Track the remainder
- Distribute remaining cents one at a time to the payees with the largest fractional parts
- Use index-based tie-breaking to ensure deterministic output

## Files Changed

- Created: `src/domain/allocation.ts` (57 lines)
- Created: `tests/domain/allocation.test.ts` (68 lines)

Total changes: 2 files, 125 insertions

## Testing and Results

### TDD Process Followed

**RED Phase:**
```
npm test
```
Output: TS2307 - Cannot find module '../../src/domain/allocation'
- This was expected; the test file references a module that doesn't exist yet
- Multiple parameter type errors also surfaced, which are resolved once the module exists

**GREEN Phase:**
```
npm test
```
Output:
```
Test Files  6 passed (6)
     Tests  42 passed (42)
```

All tests pass:
- **12 total allocation tests** covering:
  - Even allocation of divisible amounts
  - Remainder distribution (3400 ÷ 3 = 1134 + 1133 + 1133)
  - **Exhaustive guarantee test**: 7,000 combinations (-500 to 500 cents × 1-7 payees)
  - Determinism
  - Empty payee list
  - Preserving payee metadata
  - Refund allocation (negative totals: -3400 ÷ 3 = -1133 + -1133 + -1134)
  - Weighted allocation
  - Zero-weight fallback
  - Mismatched weights validation
  - Negative weight rejection

### Key Test: Exact-Sum Guarantee

The exhaustive test validates that for any total from -500 to 500 cents and any party count from 1 to 7, the allocated amounts sum exactly to the total. This test covers 7,000 iterations across both positive amounts and refunds — this is the global constraint enforcement.

Example:
- Input: 3400 cents, 3 payees
- Output: [1134, 1133, 1133] cents
- Sum: 1134 + 1133 + 1133 = 3400 ✓ (not 1133 + 1133 + 1133 = 3399)

## Commit

**Hash:** 4c7360d
**Message:** `feat: add allocation engine with exact-sum guarantee`

## Self-Review Findings

### Completeness
- All interfaces specified in the brief are implemented: `Payee`, `allocateEvenly`, `allocateByWeights`
- All test cases from the brief are present and passing
- Uses correct imports with `import type` for type-only imports per tsconfig's `verbatimModuleSyntax: true`
- Correctly imports from `./primitives` and `./entities` following established patterns

### Algorithm Correctness
- Floor-based distribution ensures no money is invented
- Largest-remainder apportionment with index-based tie-breaking ensures:
  - Deterministic output (same input always gives same output)
  - Proper remainder handling (largest fractional parts get priority)
  - Exact-sum guarantee (no cents lost or invented)
- Zero-weight handling correctly falls back to even split
- Empty payee list returns empty array

### Code Quality
- Clear comments explain the algorithm (floor, largest-remainder, index tie-breaking)
- Function signatures are clean and typed
- Error message is specific and matches test expectation (`/weights/i`)
- Code structure is simple and maintainable
- No unnecessary complexity or over-engineering

### Integration
- Works with existing domain primitives and entities
- No network calls or DOM access (per global constraints)
- Follows established patterns from earlier tasks
- Tests are collocated in `tests/domain/` directory

### Potential Concerns
None. The implementation is straightforward, the tests are comprehensive (including the exhaustive guarantee test), and all existing tests from Tasks 1-5 still pass.

## Fix Round 1: Review Findings

### Finding 1 (Important) — Negative totals untested → Fixed

**What changed:**
- Extended exhaustive invariant test to cover both positive and negative totals (-500 to 500 cents instead of 0 to 500)
- Added fixed-value refund test: `allocateEvenly(-3400, payees)` → `[-1133, -1133, -1134]`
- Algorithm already sign-agnostic and correct; new tests prevent future regressions

**Tests covering the fix:**
- `"never loses or invents a cent, for any total or party count"` (now tests 7,000 combinations)
- `"splits a refund (negative total) without losing or inventing a cent"` (new)

**Command and output:**
```
npm test
Test Files  6 passed (6)
     Tests  44 passed (44)
```

### Finding 2 (Minor, upgraded) — Negative weights silently became even split → Fixed

**What changed:**
- Added explicit check: throw if any weight is negative
- Fixed fallback condition: changed from `totalWeight === 0` to `weights.every((w) => w === 0)`
- Now rejects `[5, -5, 0]` with clear error instead of silently reinterpreting as even split

**Error message:** `"allocateByWeights: weights must not be negative"`

**Tests covering the fix:**
- `"throws when any weight is negative"` (new) — validates rejection of `[-1, 1, 1]`
- `"falls back to an even split when all weights are zero"` (existing) — confirms zero-weight fallback still works

**Command and output:**
```
npm test -- --reporter=verbose 2>&1 | grep "throws when any weight"
✓ tests/domain/allocation.test.ts > allocateByWeights > throws when any weight is negative
```

### Finding 3 (Minor) — Report number inconsistency → Fixed

**What changed:**
- Updated test count from "6 new / 10 total" to accurate "12 total allocation tests"
- Updated exhaustive test description to reflect -500 to 500 range (7,000 combinations)
- Added refund test to the test list

## Conclusion

Task 6 is complete with all review findings addressed. The allocation engine with exact-sum guarantee is implemented correctly, tested thoroughly (12 tests, 7,000 iterations on the exhaustive invariant), and committed.
