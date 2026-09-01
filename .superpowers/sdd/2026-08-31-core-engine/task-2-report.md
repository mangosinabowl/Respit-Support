# Task 2: The Event Log - Report

## What Was Implemented

Implemented the immutable domain event shape and deterministic total ordering for the event-sourced core:

1. **`src/domain/events.ts`** - Core event infrastructure:
   - `EntityType` union type: 12 entity types (party, client, role, shift, expense, trip, note, tag, preset, submission, attachment, inboxItem)
   - `DomainEvent` interface: Immutable change record with eventId, entityType, entityId, fields, recordedAt, deviceId, and seq
   - `makeEvent()` function: Creates a new event with unique ID and current timestamp
   - `compareEvents()` function: Provides total ordering by recordedAt, then deviceId, then seq

2. **`tests/domain/events.test.ts`** - 4 test cases verifying:
   - Event creation stamps correct fields, recordedAt, and unique eventId
   - Events order by recordedAt first (earlier < later)
   - Ties break deterministically by deviceId (lexicographic) then seq (numeric)
   - Shuffled stream sorts into stable total order

## Testing Results

### TDD Evidence

**RED - Failing test (before implementation)**

```bash
$ npm test
Error: Cannot find module '../../src/domain/events' imported from tests/domain/events.test.ts

FAIL  tests/domain/events.test.ts
Test Files  1 failed | 1 passed (2)
```

**GREEN - All tests passing (after implementation)**

```bash
$ npm test

✓ tests/domain/events.test.ts > events > stamps an event with a recordedAt and a unique id
✓ tests/domain/events.test.ts > events > orders by recordedAt first
✓ tests/domain/events.test.ts > events > breaks ties deterministically by deviceId then seq
✓ tests/domain/events.test.ts > events > sorts a shuffled stream into a stable total order
✓ tests/domain/primitives.test.ts > primitives > generates unique ids
✓ tests/domain/primitives.test.ts > primitives > produces a UTC ISO instant ending in Z
✓ tests/domain/primitives.test.ts > primitives > produces an IANA zone name containing a slash or UTC

Test Files  2 passed (2)
Tests  7 passed (7)
Duration  488ms
```

## Files Changed

- **Created**: `src/domain/events.ts` (54 lines)
- **Created**: `tests/domain/events.test.ts` (42 lines)

Total: 2 new files, 96 insertions

## Self-Review Findings

✓ Code matches brief verbatim
✓ All 4 new tests passing
✓ All 3 Task 1 tests still passing (backward compatible)
✓ Type-only imports use `import type` (verbatimModuleSyntax: true compliance)
✓ No network calls, no DOM access - purely domain logic
✓ compareEvents returns correct -1/0/1 values for sorting
✓ Timestamp fields are ISOInstant (UTC Z-ended strings) as required
✓ Event IDs use newId() ensuring uniqueness
✓ No stray warnings or noise in test output
✓ TDD order followed exactly: failing test → implementation → passing tests
✓ Global constraints observed: immutable events, separate recordedAt field, IANA zones via primitives

## Commit

```
1661e83 feat: add domain event shape and deterministic total ordering
```

## Notes

- Implementation is transcription-only, matching brief requirements exactly
- Event ordering correctly implements the spec: time first, then device ID (alphabetically), then per-device sequence number
- The total order enables deterministic replay for last-write-wins semantics without additional bookkeeping
- All Task 1 tests remain green, confirming no regression
