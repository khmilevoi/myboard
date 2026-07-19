# TypeScript 7 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure current (TypeScript 6.0.3) typecheck and build wall-clock times, migrate the workspace to TypeScript 7 (the native Go-ported compiler, published as `typescript@7.0.2`), then re-measure and record a before/after comparison in the repo.

**Architecture:** A single reusable benchmarking script (`scripts/bench-typecheck-build.ts`) runs the exact commands developers already use (`pnpm run typecheck`, `pnpm run build`) N times each, clearing the one known incremental-typecheck cache first, and appends structured results to a JSON file keyed by phase (`before` / `after`). The migration itself is a one-line catalog version bump in `pnpm-workspace.yaml` plus whatever fixes the resulting typecheck/build runs demand. A final markdown report is written by hand from the two JSON snapshots once both phases exist.

**Tech Stack:** pnpm workspace catalog, `typescript` 6.0.3 → 7.0.2, `tsx` (already a devDependency) to run the bench script, no new dependencies.

## Global Constraints

- Target version: `typescript@^7.0.2` (current `latest` dist-tag; confirmed via `npm view typescript dist-tags`) — matches the existing caret-range convention used for `^6.0.3`.
- Node requirement for TS7: `>=16.20.0` — already satisfied (`node -v` reports v24.13.0 in this environment).
- No tsconfig in the repo uses a compiler option removed in TS7 (e.g. `downlevelIteration`) — verified by reading all 10 tsconfig files. No config changes are anticipated beyond the version bump.
- Every tsconfig in the repo sets `noEmit: true` — nothing in this repo emits `.d.ts` or transpiled JS via `tsc`; all JS output goes through esbuild/swc/rolldown (Vite/Rspack). TS7's declaration-emit behavior changes (parenthesization, mapped-type `any` fallback) are therefore irrelevant to this migration.
- No package in the repo imports the TypeScript Compiler API (`from 'typescript'` / `require('typescript')` beyond tooling in `pnpm-lock.yaml`) — confirmed by grep. This matters because TS7's default export changed from the classic `ts.createProgram`/`ts.transpileModule` API to `./lib/version.cjs` plus a new `./unstable/*` surface; since nothing here calls that API directly, this breaking change doesn't affect us.
- None of the workspace's build tooling (`vite@8.1.2`, `vitest@4.1.9`, `@vitejs/plugin-react@6.0.2`, `@module-federation/vite@1.16.12`, `tsx@4.20.6`) declares a `peerDependencies` entry on `typescript` — confirmed via `npm view <pkg> peerDependencies`. No peer-conflict warnings expected from the bump.
- Known non-blocking caveat (do not attempt to fix as part of this plan): `.zed/settings.json` points `vtsls`'s `tsdk` at `./packages/client/node_modules/typescript/lib`. TS7's native compiler exposes a different Language Service surface (LSP "in progress" per the `microsoft/typescript-go` README) and may not ship the classic `tsserver.js` that `vtsls` expects. This can affect the Zed editor's TS language service after the bump; it does not affect `tsc --noEmit` or the build pipeline. Mention it to the user at the end; do not scope work to fix it here.
- Only `packages/client/tsconfig.json` and `packages/client/tsconfig.node.json` set `"incremental": true"` with a `tsBuildInfoFile` (`node_modules/.cache/tsconfig.tsbuildinfo` and `.../tsconfig.node.tsbuildinfo`, both under `packages/client/node_modules/.cache/`). These are the only on-disk caches that make a "cold" vs "warm" typecheck run differ; no other package and no build tool (`rspack`, `vite`) has a persistent cache directory in this repo today.

---

## File Structure

- **Create `scripts/bench-typecheck-build.ts`** — standalone benchmarking script, run via `tsx`. Not wired into `package.json` scripts (one-off tool, not a permanent CI step); invoked directly.
- **Create `docs/typescript-7-migration/benchmarks.json`** — machine-written by the script; holds `{ before: {...}, after: {...} }`. Never hand-edited.
- **Modify `pnpm-workspace.yaml`** — bump the `typescript` catalog entry.
- **Create `docs/typescript-7-migration.md`** — the human-readable before/after report, written by hand once both phases' JSON exists.

---

### Task 1: Benchmark script + baseline ("before") measurement

**Files:**
- Create: `scripts/bench-typecheck-build.ts`
- Create (script output): `docs/typescript-7-migration/benchmarks.json`

**Interfaces:**
- Produces: a JSON file at `docs/typescript-7-migration/benchmarks.json` with shape `{ [phase: 'before'|'after']: { typescript: string, node: string, typecheck: { coldSeconds: number, warmRunsSeconds: number[], warmMedianSeconds: number|null }, build: { runsSeconds: number[], medianSeconds: number } } }`. Task 3 reads this file for both phases.

- [ ] **Step 1: Write the benchmark script**

Create `scripts/bench-typecheck-build.ts`:

```typescript
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const REPO_ROOT = resolve(import.meta.dirname, '..')
const RESULTS_DIR = resolve(REPO_ROOT, 'docs/typescript-7-migration')
const RESULTS_FILE = resolve(RESULTS_DIR, 'benchmarks.json')

const TYPECHECK_CACHE_FILES = [
  resolve(REPO_ROOT, 'packages/client/node_modules/.cache/tsconfig.tsbuildinfo'),
  resolve(REPO_ROOT, 'packages/client/node_modules/.cache/tsconfig.node.tsbuildinfo'),
]

interface Args {
  phase: 'before' | 'after'
  typecheckRuns: number
  buildRuns: number
}

function parseArgs(): Args {
  const args = process.argv.slice(2)
  const phaseArg = args.find((a) => a.startsWith('--phase='))?.split('=')[1]
  if (phaseArg !== 'before' && phaseArg !== 'after') {
    throw new Error(
      'Usage: tsx scripts/bench-typecheck-build.ts --phase=before|after [--typecheck-runs=N] [--build-runs=N]',
    )
  }
  const typecheckRuns = Number(args.find((a) => a.startsWith('--typecheck-runs='))?.split('=')[1] ?? 3)
  const buildRuns = Number(args.find((a) => a.startsWith('--build-runs='))?.split('=')[1] ?? 2)
  return { phase: phaseArg, typecheckRuns, buildRuns }
}

function clearTypecheckCache(): void {
  for (const file of TYPECHECK_CACHE_FILES) {
    if (existsSync(file)) rmSync(file)
  }
}

function timeCommand(command: string): number {
  const start = process.hrtime.bigint()
  execSync(command, { cwd: REPO_ROOT, stdio: 'inherit' })
  const end = process.hrtime.bigint()
  return Number(end - start) / 1e9
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

function typescriptVersion(): string {
  return execSync(
    'pnpm --filter client exec node -p "require(\'typescript/package.json\').version"',
    { cwd: REPO_ROOT, encoding: 'utf-8' },
  ).trim()
}

function main(): void {
  const { phase, typecheckRuns, buildRuns } = parseArgs()
  const tsVersion = typescriptVersion()

  console.log(`\n=== Benchmarking phase: ${phase} ===`)
  console.log(`TypeScript version: ${tsVersion}`)
  console.log(`Node version: ${process.version}\n`)

  console.log('--- typecheck (cold) ---')
  clearTypecheckCache()
  const typecheckCold = timeCommand('pnpm run typecheck')

  const typecheckWarm: number[] = []
  for (let i = 1; i < typecheckRuns; i++) {
    console.log(`--- typecheck (warm ${i}/${typecheckRuns - 1}) ---`)
    typecheckWarm.push(timeCommand('pnpm run typecheck'))
  }

  const buildRunsSeconds: number[] = []
  for (let i = 1; i <= buildRuns; i++) {
    console.log(`--- build (${i}/${buildRuns}) ---`)
    buildRunsSeconds.push(timeCommand('pnpm run build'))
  }

  const results = {
    typescript: tsVersion,
    node: process.version,
    typecheck: {
      coldSeconds: typecheckCold,
      warmRunsSeconds: typecheckWarm,
      warmMedianSeconds: typecheckWarm.length > 0 ? median(typecheckWarm) : null,
    },
    build: {
      runsSeconds: buildRunsSeconds,
      medianSeconds: median(buildRunsSeconds),
    },
  }

  mkdirSync(RESULTS_DIR, { recursive: true })
  const existing: Record<string, unknown> = existsSync(RESULTS_FILE)
    ? JSON.parse(readFileSync(RESULTS_FILE, 'utf-8'))
    : {}
  existing[phase] = results
  writeFileSync(RESULTS_FILE, `${JSON.stringify(existing, null, 2)}\n`)

  console.log(`\nSaved ${phase} results to ${RESULTS_FILE}`)
  console.log(JSON.stringify(results, null, 2))
}

main()
```

- [ ] **Step 2: Confirm the current TypeScript version is still 6.0.3 before measuring**

Run: `pnpm --filter client exec node -p "require('typescript/package.json').version"`
Expected: `6.0.3`

- [ ] **Step 3: Run the baseline benchmark**

Run: `npx tsx scripts/bench-typecheck-build.ts --phase=before`
Expected: exits 0; prints a `before` results object; `docs/typescript-7-migration/benchmarks.json` now contains a `before` key. This runs `pnpm run typecheck` 3 times (1 cold + 2 warm) and `pnpm run build` 2 times — expect several minutes of output on screen, all real `tsc`/`vite`/`rspack` output from the existing commands.

If either underlying command fails (non-zero exit), the script throws and no JSON is written — fix whatever is failing (this would indicate a pre-existing break unrelated to TS7) before proceeding.

- [ ] **Step 4: Inspect the baseline numbers**

Run: `cat docs/typescript-7-migration/benchmarks.json` (or read the file)
Expected: a `before` object with populated `coldSeconds`, `warmRunsSeconds` (array of 2 numbers), `warmMedianSeconds`, and `build.runsSeconds` (array of 2 numbers) with `medianSeconds`.

- [ ] **Step 5: Commit**

```bash
git add scripts/bench-typecheck-build.ts docs/typescript-7-migration/benchmarks.json
git commit -m "chore: add typecheck/build benchmark script, capture TS 6.0.3 baseline"
```

---

### Task 2: Migrate the workspace to TypeScript 7

**Files:**
- Modify: `pnpm-workspace.yaml:38` (catalog `typescript` entry)

**Interfaces:**
- Consumes: nothing from Task 1 besides having a clean baseline to compare against later.
- Produces: a workspace where every package resolves `typescript@7.0.2` from the catalog, `pnpm run typecheck` and `pnpm run build` both exit 0.

- [ ] **Step 1: Bump the catalog version**

In `pnpm-workspace.yaml`, change:

```yaml
  typescript: ^6.0.3
```

to:

```yaml
  typescript: ^7.0.2
```

- [ ] **Step 2: Reinstall**

Run: `pnpm install`
Expected: exits 0. Since none of the workspace's tooling declares a `typescript` peerDependency (verified in Global Constraints), expect no peer-dependency warnings related to this bump. The new `typescript` package pulls in `@typescript/typescript-win32-x64` (and other platform packages, `os`/`cpu`-gated like `esbuild`) as optional dependencies — no `onlyBuiltDependencies` entry is needed since these platform packages have no install scripts (verified via `npm view @typescript/typescript-win32-x64@7.0.2 scripts` — empty).

- [ ] **Step 3: Confirm the resolved version**

Run: `pnpm --filter client exec node -p "require('typescript/package.json').version"`
Expected: `7.0.2`

- [ ] **Step 4: Run typecheck across the workspace**

Run: `pnpm run typecheck`
Expected: exits 0, same as before the bump. If it fails, read the reported errors (each names an exact file/line) and fix them before continuing — do not proceed with a red typecheck. Given every tsconfig here is already free of removed options and uses modern settings (see Global Constraints), no failures are expected; TS7's 7.0 release is explicitly scoped to behavioral parity with 6.0 aside from crash fixes.

- [ ] **Step 5: Run the full build**

Run: `pnpm run build`
Expected: exits 0. If it fails, read the error output and fix it before continuing.

- [ ] **Step 6: Run the workspace test suite as a regression check**

Run: `pnpm test`
Expected: exits 0, no new failures relative to `main`.

- [ ] **Step 7: Commit**

```bash
git add pnpm-workspace.yaml pnpm-lock.yaml
git commit -m "chore: migrate to TypeScript 7 (typescript@7.0.2)"
```

---

### Task 3: Post-migration ("after") measurement + comparison report

**Files:**
- Create: `docs/typescript-7-migration.md`
- Modify (script output): `docs/typescript-7-migration/benchmarks.json`

**Interfaces:**
- Consumes: `docs/typescript-7-migration/benchmarks.json`'s `before` key (written in Task 1) and the `after` key this task produces, using the exact same script so methodology is identical between phases.

- [ ] **Step 1: Run the post-migration benchmark**

Run: `npx tsx scripts/bench-typecheck-build.ts --phase=after`
Expected: exits 0; `docs/typescript-7-migration/benchmarks.json` now has both `before` and `after` keys.

- [ ] **Step 2: Read both phases and write the comparison report**

Read `docs/typescript-7-migration/benchmarks.json`, then create `docs/typescript-7-migration.md` with this structure (fill in the `{{...}}` placeholders with the actual numbers read from the JSON — these are the only two files where real numbers replace placeholders, not code):

```markdown
# TypeScript 7 Migration — Benchmark Results

Migrated `typescript` from `{{before.typescript}}` to `{{after.typescript}}` (native Go-ported compiler, `typescript@7.0.2` / package `@typescript/native-preview` lineage). Measured with `scripts/bench-typecheck-build.ts` on Node `{{before.node}}`.

## `pnpm run typecheck`

| | cold (s) | warm run 1 (s) | warm run 2 (s) | warm median (s) |
|---|---|---|---|---|
| TypeScript {{before.typescript}} | {{before.typecheck.coldSeconds}} | {{before.typecheck.warmRunsSeconds[0]}} | {{before.typecheck.warmRunsSeconds[1]}} | {{before.typecheck.warmMedianSeconds}} |
| TypeScript {{after.typescript}} | {{after.typecheck.coldSeconds}} | {{after.typecheck.warmRunsSeconds[0]}} | {{after.typecheck.warmRunsSeconds[1]}} | {{after.typecheck.warmMedianSeconds}} |

Warm-median delta: {{compute (after.warmMedianSeconds - before.warmMedianSeconds)}}s ({{compute percentage}}%).

## `pnpm run build`

| | run 1 (s) | run 2 (s) | median (s) |
|---|---|---|---|
| TypeScript {{before.typescript}} | {{before.build.runsSeconds[0]}} | {{before.build.runsSeconds[1]}} | {{before.build.medianSeconds}} |
| TypeScript {{after.typescript}} | {{after.build.runsSeconds[0]}} | {{after.build.runsSeconds[1]}} | {{after.build.medianSeconds}} |

Median delta: {{compute (after.medianSeconds - before.medianSeconds)}}s ({{compute percentage}}%).

## Notes

- All packages in this repo set `noEmit: true`; `tsc`/`tsgo` is used purely for type checking, never for emit — these numbers isolate type-checking speed, not bundling.
- Raw data: `docs/typescript-7-migration/benchmarks.json`.
- Known caveat: Zed's `vtsls` `tsdk` setting (`.zed/settings.json`) targets the classic `tsserver.js` language service, which TS7's native compiler may not ship in the same shape (LSP support was "in progress" upstream at migration time) — this affects editor tooling only, not `tsc --noEmit` or build output.
```

Replace every `{{...}}` with the literal value read from the JSON (plain numbers, not further placeholders), and compute the deltas by hand from those same numbers.

- [ ] **Step 3: Commit**

```bash
git add docs/typescript-7-migration.md docs/typescript-7-migration/benchmarks.json
git commit -m "docs: record TypeScript 6.0.3 -> 7.0.2 typecheck/build benchmark comparison"
```

---

## Self-Review Notes

- **Spec coverage:** "снять замеры" → Task 1. "провести миграцию" → Task 2. "замеры еще раз для сравнения" → Task 3. "записать это в файл" → `docs/typescript-7-migration.md` (+ raw JSON alongside it).
- **Placeholder scan:** Task 3's report template uses `{{...}}` intentionally — these are filled from real measured data at execution time, not deferred implementation detail; flagged explicitly in the step text.
- **Type consistency:** the JSON shape produced by the script in Task 1 (`typecheck.coldSeconds`, `typecheck.warmRunsSeconds`, `typecheck.warmMedianSeconds`, `build.runsSeconds`, `build.medianSeconds`) is the exact shape Task 3 reads — same script, same keys, no drift.
