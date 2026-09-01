### Task 1: Repository, toolchain, and a passing test

**Files:**
- Create: `.gitignore`, `package.json`, `tsconfig.json`, `vite.config.ts`, `src/domain/primitives.ts`
- Test: `tests/domain/primitives.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npm test`; `newId(): Id`, `nowInstant(): ISOInstant`, `localZone(): IanaZone`.

**Critical:** this folder contains a client's safety plan PDF, an ABC chart, and a `Rory/` directory of client material. The `.gitignore` below must be written **before** the first `git add`, and the first commit must be inspected to confirm no client material is staged.

- [ ] **Step 1: Initialise the repository and write .gitignore first**

```bash
cd "C:/Users/aandr/OneDrive/Documentos/Respit Support"
git init
```

Create `.gitignore` with exactly this content:

```gitignore
# Client material — MUST NOT be committed
*.pdf
/Rory/
/*.png
/*.jpg
/*.jpeg

# Tooling
node_modules/
dist/
dev-dist/
coverage/
.env
.env.local
*.local
.DS_Store
```

- [ ] **Step 2: Verify no client material would be committed**

```bash
git add -A && git status --short
```

Expected: the listing contains `.gitignore` and `docs/superpowers/...` only. It must **not** contain `ABC Chart_260831_090920.pdf`, `RR Safety plan 13-Aug-2026 18-53-14.pdf`, or anything under `Rory/`. If any client file appears, stop, run `git reset`, fix `.gitignore`, and repeat this step.

- [ ] **Step 3: Scaffold the project**

```bash
npm create vite@latest . -- --template vanilla-ts
npm install
npm install --save-dev vitest fake-indexeddb
npm install dexie
```

If Vite refuses because the directory is not empty, accept its prompt to continue in the existing directory. Do not let it delete existing files.

- [ ] **Step 4: Configure the test runner**

Create `vite.config.ts`:

```typescript
import { defineConfig } from "vite";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
```

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 5: Write the failing test**

Create `tests/domain/primitives.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { newId, nowInstant, localZone } from "../../src/domain/primitives";

describe("primitives", () => {
  it("generates unique ids", () => {
    const a = newId();
    const b = newId();
    expect(a).not.toEqual(b);
    expect(a.length).toBeGreaterThan(20);
  });

  it("produces a UTC ISO instant ending in Z", () => {
    const t = nowInstant();
    expect(t).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it("produces an IANA zone name containing a slash or UTC", () => {
    const z = localZone();
    expect(z === "UTC" || z.includes("/")).toBe(true);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `../../src/domain/primitives`.

- [ ] **Step 7: Write the implementation**

Create `src/domain/primitives.ts`:

```typescript
/** A stable unique identifier, generated on-device. */
export type Id = string;

/** Money in integer minor units (cents). 3450 === $34.50. Never a float. */
export type Money = number;

/** A UTC instant, ISO-8601 with milliseconds, always ending in Z. */
export type ISOInstant = string;

/** An IANA timezone name, e.g. "America/Los_Angeles". */
export type IanaZone = string;

export function newId(): Id {
  return crypto.randomUUID();
}

export function nowInstant(): ISOInstant {
  return new Date().toISOString();
}

export function localZone(): IanaZone {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/** Whole minutes between two instants. Negative if `to` precedes `from`. */
export function minutesBetween(from: ISOInstant, to: ISOInstant): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 60000);
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — the new tests, plus every earlier test still green.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold project, protect client files, add time and id primitives"
```

---

