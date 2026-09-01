# Task 1 Report: Repository, toolchain, and a passing test

## What I implemented

Per the controller overrides, Steps 1-2 (git init, `.gitignore`, initial client-material check) were already done and were left untouched. I started at Step 3.

- Hand-wrote `package.json` (name `respite-support`, `"type": "module"`, `"private": true`, `test`/`test:watch` scripts) instead of running `npm create vite@latest`.
- Installed exactly the specified packages:
  - `npm install --save-dev typescript vitest fake-indexeddb`
  - `npm install dexie`
- Hand-wrote `tsconfig.json`: `strict`, `target: ES2022`, `module: ESNext`, `moduleResolution: bundler`, `lib: ["ES2022", "DOM"]`, `noEmit: true`, `verbatimModuleSyntax: true`, `skipLibCheck: true`, `include: ["src", "tests"]`.
- Hand-wrote `vitest.config.ts` (in place of `vite.config.ts`) with `environment: "node"` and `include: ["tests/**/*.test.ts"]`, exactly as specified.
- Wrote the test `tests/domain/primitives.test.ts` verbatim from the brief.
- Wrote `src/domain/primitives.ts` verbatim from the brief: `Id`, `Money`, `ISOInstant`, `IanaZone` types; `newId()`, `nowInstant()`, `localZone()`, `minutesBetween()`.
- Followed TDD order: failing test first, confirmed failure, then implementation, then confirmed pass.
- Ran the full suite once more before committing.
- Committed with the brief's exact message.

## Incident during Step 3 (important — read this)

My first `npm install --save-dev typescript vitest fake-indexeddb`, run before any `package.json` existed in the target directory, was executed with cwd correctly set to `Respit Support`. However, npm walks up the directory tree looking for an existing `package.json` when none is found in cwd, and it found one at `C:\Users\aandr\package.json` — the user's home directory, an unrelated project containing crypto/wallet SDKs (`@safe-global/safe-*`, `web3`, `ethers`, `@web3-onboard/*`, etc.). npm treated that as the project root and:
- Added `devDependencies: { "fake-indexeddb": "^6.2.5", "typescript": "^7.0.2", "vitest": "^4.1.11" }` to `C:\Users\aandr\package.json`.
- Rewrote `C:\Users\aandr\package-lock.json` (reported "changed 1 package, and audited 953 packages").
- Added `node_modules/typescript`, `node_modules/vitest`, `node_modules/fake-indexeddb` (and their transitive deps) under `C:\Users\aandr\node_modules`.

I caught this by inspecting `C:\Users\aandr\package.json` immediately after the install (it is not a git repo, so no version control safety net existed there). Remediation:
1. Manually removed the `devDependencies` block I had added (there was no `devDependencies` key before, since the file only had `dependencies` and matched exactly what I'd added).
2. Deleted the three stray `node_modules` folders.
3. Ran a plain `npm install` (no package args) in `C:\Users\aandr` to reconcile `package-lock.json` against the corrected `package.json`. Result: "added 1 package, removed 38 packages" — the 38 removed correspond to my 3 packages plus their transitive tree; the 1 added is `typescript@7.0.2` resolving as an **optional peer dependency** already declared by existing packages in that tree (e.g. `abitype`, used by the web3/wagmi stack) — confirmed by inspecting `package-lock.json`, where `typescript` appears with `"peer": true` and is pulled in only via `peerDependencies` of packages that were already present. This same peer auto-install would happen on any fresh `npm install` in that directory regardless of my error, so I'm confident this reconciliation restored the original state (vulnerability count was unchanged at 90 both before and after: initial bad install audited 953 packages/90 vulns, corrected state audits 906 packages/90 vulns).

I cannot obtain a byte-for-byte diff against the true original state of `C:\Users\aandr\package-lock.json` (no git, no OneDrive versioning at that path — OneDrive only covers `C:\Users\aandr\OneDrive\...`, not the home directory root itself). The evidence above is strong but not a mathematical guarantee. **I recommend the user spot-check `C:\Users\aandr\package.json` and confirm nothing looks wrong**, and consider that project a lower priority for review since it appears to be unrelated tooling/scripts rather than a deployed/signing project.

To prevent recurrence, before installing anything else I created `package.json` directly in `Respit Support` first, then verified `npm prefix` resolved to the correct directory before proceeding with any further installs.

## What I tested and the results

`npm test` (`vitest run`) — full suite, 1 file, 3 tests, all passing, clean output with no warnings.

Also ran `npx tsc --noEmit` as an extra sanity check on the hand-written `tsconfig.json` (not a brief step, but worth verifying given strict settings) — no errors.

## TDD Evidence

### RED

Command: `npm test` (run after writing `tests/domain/primitives.test.ts`, before `src/domain/primitives.ts` existed)

```
> respite-support@0.0.0 test
> vitest run

 RUN  v4.1.11 C:/Users/aandr/OneDrive/Documentos/Respit Support

 ❯ tests/domain/primitives.test.ts (0 test)

⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  tests/domain/primitives.test.ts [ tests/domain/primitives.test.ts ]
Error: Cannot find module '../../src/domain/primitives' imported from C:/Users/aandr/OneDrive/Documentos/Respit Support/tests/domain/primitives.test.ts

 Test Files  1 failed (1)
      Tests  no tests
```

This failure is expected: the test imports from `../../src/domain/primitives`, which did not yet exist.

### GREEN

Command: `npm test` (run after writing `src/domain/primitives.ts`)

```
> respite-support@0.0.0 test
> vitest run

 RUN  v4.1.11 C:/Users/aandr/OneDrive/Documentos/Respit Support

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  831ms
```

Re-ran once more immediately before committing (final full-suite run):

```
 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  394ms
```

## Files changed (this commit, `2ec0eb6`)

- `package.json` (new)
- `package-lock.json` (new)
- `tsconfig.json` (new)
- `vitest.config.ts` (new)
- `tests/domain/primitives.test.ts` (new)
- `src/domain/primitives.ts` (new)

`.gitignore` was verified unchanged (`git diff 6ff8ff7 HEAD -- .gitignore` produced no output).

## Client-material check output

```
$ git ls-files | grep -iE '\.pdf$|^Rory/' || echo "NONE - clean"
NONE - clean
```

Full tracked file list after commit:
```
.gitignore
docs/superpowers/plans/2026-08-31-core-engine.md
docs/superpowers/specs/2026-08-31-respite-support-design.md
package-lock.json
package.json
src/domain/primitives.ts
tests/domain/primitives.test.ts
tsconfig.json
vitest.config.ts
```

No PDFs, no `Rory/` content, no `node_modules/` tracked.

## Self-review findings

- Code matches the brief verbatim for the test and `src/domain/primitives.ts` — no embellishment.
- `src/domain/primitives.ts` uses only `crypto.randomUUID()`, `Date`, and `Intl.DateTimeFormat` — no network calls, no DOM access. Satisfies the global constraint that `src/domain/` stays plain-Node-testable.
- `Money` is typed as `number` per the brief's own comment ("integer minor units (cents)... Never a float") — this is a type-level convention only; no floating-point arithmetic is introduced in this task since no money-handling logic exists yet. Future tasks that operate on `Money` will need to actually respect the integer-cents constraint in their logic, not just the type alias.
- `tsconfig.json` and `vitest.config.ts` match the controller's exact specified content.
- `package.json` matches the controller's exact specified fields, plus the dependency entries that `npm install` legitimately added.
- No stray files, no leftover debug output, no warnings in test output.

## Issues or concerns

The npm-install-hit-the-wrong-directory incident described above is the one notable concern. I believe it is fully remediated based on the evidence (matching vulnerability counts, the removed/added package counts lining up exactly, and the "added" package being explained by a pre-existing optional peer dependency), but I cannot get a cryptographic guarantee against the pre-incident state because that directory has no version control. Flagging for the user's awareness per the safety rules around unintended side effects outside the task's scope.
