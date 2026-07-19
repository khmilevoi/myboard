# TypeScript 7 Migration — Benchmark Results

Migrated `typescript` from `6.0.3` to `7.0.2` (native Go-ported compiler, the "TypeScript Native
Preview" / `tsgo` lineage that became `typescript@7.x` at its 7.0 RC/GA). Measured with
`scripts/bench-typecheck-build.ts` on Node `v24.13.0`, running the exact commands developers
already use (`pnpm run typecheck`, `pnpm run build`) against this repo's 9-package pnpm workspace.

## `pnpm run typecheck`

| | cold (s) | warm run 1 (s) | warm run 2 (s) | warm median (s) |
|---|---|---|---|---|
| TypeScript 6.0.3 | 18.84 | 15.88 | 17.52 | 16.70 |
| TypeScript 7.0.2 | 5.81 | 5.32 | 6.40 | 5.86 |

- Cold typecheck: **-13.03s (-69.2%)** — TS7 is **3.24x** faster.
- Warm-median typecheck: **-10.84s (-64.9%)** — TS7 is **2.85x** faster.

## `pnpm run build`

| | run 1 (s) | run 2 (s) | median (s) |
|---|---|---|---|
| TypeScript 6.0.3 | 16.59 | 15.23 | 15.91 |
| TypeScript 7.0.2 | 12.87 | 12.70 | 12.79 |

- Median delta: **-3.13s (-19.6%)** — TS7 is **1.24x** faster.

The build number moves less than typecheck because `pnpm run build` only runs `tsc` once (the
`pnpm --filter client typecheck` step that runs concurrently with the widget builds) — the rest of
build time is Rspack/Vite/rolldown bundling, which doesn't touch the TypeScript compiler at all.
The type-checking portion of that number still improved the same way the standalone `typecheck`
numbers show.

## Notes

- All packages in this repo set `noEmit: true`; `tsc` is used purely for type checking, never for
  emit — these numbers isolate type-checking speed, not bundling, and TS7's declaration-emit
  changes (parenthesization, mapped-type `any` fallback) don't apply here.
- Every `pnpm run typecheck` invocation (cold and warm alike) re-runs `codegen` first (per the root
  `package.json` script), so none of these numbers are pure `tsc`-only timings — codegen cost is
  identical across both TypeScript versions and cancels out in the comparison, but it means the
  absolute numbers include a fixed constant overhead beyond just type checking.
- Migration required zero source or `tsconfig.*.json` changes: no removed compiler option was in
  use anywhere in the repo, no code imports the TypeScript Compiler API directly, and no build
  tool in this workspace declares a `peerDependencies` range on `typescript` — `pnpm run typecheck`,
  `pnpm run build`, and the full `pnpm test` suite all passed with zero new errors and identical
  test counts to the pre-migration baseline.
- Raw data: `docs/typescript-7-migration/benchmarks.json`.
- Known caveat, out of scope for this benchmark: Zed's `vtsls` `tsdk` setting (`.zed/settings.json`)
  targets the classic `tsserver.js` language service. TS7's native compiler has a different, still
  "in progress" Language Service surface upstream — worth checking editor autocomplete/diagnostics
  still work as expected after this migration lands, separately from the typecheck/build numbers
  above.
