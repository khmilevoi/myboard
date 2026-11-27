# Running tests and tooling on this machine

Symptom-indexed. Everything here is about the local environment, not about the code under test.

The rule behind most of it: **when a gate goes red, establish the baseline before diagnosing.** Run
the same command in a fresh worktree of `origin/dev` with its own `pnpm install`. Several of the
failures below are repo- or checkout-wide and read exactly like a regression you just caused.

## `pnpm` / `node` not found, or `Access is denied`

Run all `pnpm`, `node`, `npm` and `corepack` commands outside Codex's default sandbox with escalated
permissions. In this environment the executables live under `C:\nvm4w\nodejs` and
`C:\Users\Khmil\AppData\Local\pnpm`, and sandboxed runs fail with exactly these two errors.

## `rg` is unavailable

Use PowerShell-native discovery — `Get-ChildItem -Recurse`, `Select-String`, `Get-Content` — instead
of spending time fixing PATH.

## `git worktree add` fails on `AGENTS.md`

`unable to create symlink AGENTS.md: Permission denied`, then `fatal: Could not reset index file to
revision 'HEAD'`. The directory is left behind but never registered. `AGENTS.md` is committed as
mode `120000` (a symlink to `CLAUDE.md`) and Windows refuses to create it without Developer Mode.

Create the worktree with symlinks off, then hide the resulting typechange so it can never be
committed — this is the command the [feature workflow](../../CLAUDE.md#feature-workflow) uses:

```bash
git -c core.symlinks=false worktree add .worktrees/<name> -b feat/<name> origin/dev
git -C .worktrees/<name> update-index --skip-worktree AGENTS.md
```

Without the second command `git status` shows ` T AGENTS.md` forever, `git add .` would commit the
symlink as plain text, and `git stash` cannot restore it. If a failed attempt already left a
directory behind, delete it and run `git worktree prune` before retrying.

## A Vitest path filter matches nothing, or runs the whole suite

`pnpm --filter client test -- <file>` does **not** scope here — it runs the entire client suite.
Use the package's own Vitest entrypoint, with paths relative to `packages/client`:

```bash
pnpm --filter client exec vitest run src/board/model/board-storage.test.ts
```

## `pnpm check` goes red before it reaches typecheck or tests

`check` runs its five legs through `concurrently -g --kill-others-on-fail`, so the first red leg
kills the rest and the composite never reports the others. Two traps when reading its output:
`-g` buffers each leg and prints it on completion, so piping through `Select-Object -Last N`
silently discards the earlier legs, and only the last `exited with code` line survives that window.
Trust the process exit code, or re-run individual legs.

Do not reformat documentation to make `format:check` green — `.oxfmtrc.json` ignores `**/*.md` and
`docs/**`, so a markdown file cannot be the cause.

## How the unit suite runs, and why a test times out

`pnpm test` is one root Vitest process (`vitest.config.ts`) with every package as a project and
one shared worker pool — not `pnpm -r test`, which ran up to four packages at once, each with a
pool sized to the whole machine (~28 workers on 8 cores) and produced a different 5 s timeout
flake on most runs. Run one package with `pnpm exec vitest run --project <name>` from the root
(the name is the package name, e.g. `widgets-passport-checker`), or `pnpm --filter <pkg> test`.

Most of the suite's wall time is per-file module loading, not tests: on this machine a cold
`require('jsdom')` takes 3–4 s, and every jsdom file pays it again in a fresh fork. That makes the
suite sensitive to *other* load — another session's test run, a docker e2e build — so jsdom projects
share a 30 s `testTimeout`. Do not switch the pool to `vmForks`/`vmThreads` to win that time back;
`vitest.config.ts` explains the `errore` realm problem it causes.

If a test still times out: it is waiting on something, not slow. Look for a fixed sleep followed by
a positive assertion (`setTimeout(resolve, 50)` then `expect(...).toHaveBeenCalled()`) and wait for
the outcome with `vi.waitFor` instead; a fixed sleep is only legitimate before a "nothing happened"
assertion.

## How the board e2e suite isolates workers

Every Playwright worker starts its own stack in the worker-scoped `stack` fixture
(`packages/client/e2e/support/stack.ts`): a test-server on `18787+n`, Valkey database `n+1`, and a
`vite preview` on `14173+n` whose origin is the worker's `baseURL`. `/api/test/reset` and
`/api/test/time` therefore only touch the calling worker, and specs run in parallel. Specs import
`test`/`expect` from `./support/test.js`, never from `@playwright/test` (the nginx specs are the
exception: they run against a deployed stack).

`globalSetup` builds the server bundle and the client once per run; `E2E_SKIP_BUILD=1` reuses the
last build while iterating on a spec, and `E2E_WORKERS=<n>` overrides the worker count (default:
half the cores).

`docker-compose.e2e.yml` has no static project name and publishes Valkey on an ephemeral port, so
two worktrees can run `pnpm test:e2e:docker` at the same time.

## `Temporal is not defined`

The workspace requires Node 26 (`engines.node: ">=26"`), where `Temporal` is an unflagged global. No
Vitest config passes `--harmony-temporal` any more, so a missing `Temporal` means the wrong Node is
on PATH, not a missing flag.

## `ERR_REQUIRE_ESM` from `html-encoding-sniffer` / `@exodus/bytes`

A model-only test is failing during jsdom worker startup. Prefer `// @vitest-environment node` for
that file. If importing storage code constructs Dexie, add `import 'fake-indexeddb/auto'` before
importing the model.

## A Reatom effect never fires in a test

`context.reset()` aborts module-level `effect(...)` subscriptions. Export the effect when it is part
of the behavior under test, subscribe in `beforeEach`, and unsubscribe in `afterEach`.

Effects also run through Reatom queues. Flush with `vi.waitFor(...)` or `schedule(() => undefined)`
from `@reatom/core` before asserting effect-driven changes.

## The main checkout's `node_modules` is rotten

Work happens in `.worktrees/*`, so the root install at `C:\Users\Khmil\JsProjects\myboard` goes
untouched for weeks and decays. All three symptoms surface right after a merge and read as "my merge
broke the build", while the branch's own worktree was green minutes earlier.

- **`pnpm install` → `EACCES: permission denied` on a path that does not exist.** Dangling junctions
  (`packages/<pkg>/node_modules/@types/node`, `@rspack/.ignored_core`, …) whose store target was
  garbage-collected: `Test-Path` says False while opening says access denied. Delete the reparse
  point (`[IO.Directory]::Delete($path, $false)` removes the link, not the target) or the whole
  package `node_modules`, then reinstall. It is not a lock — killing processes does not help.
- **`pnpm typecheck` → `Cannot find module …typescript@<old>\bin\tsc`.** Stale per-package `.bin/tsc`
  shims pinned to a TypeScript the store no longer has. Delete `tsc`/`tsc.CMD`/`tsc.ps1` from those
  `.bin` directories and the run falls back to the root shim. `pnpm install` reports "Already up to
  date" and will not repair them.
- **Every `vitest run` → `[UNRESOLVED_ENTRY] Cannot resolve entry module <pkg>\vitest.config.ts`.**
  Rolldown cannot resolve any config in this checkout — the root one, every package one, and an
  untouched `.mjs` outside the repo all fail identically, while `pnpm lint` and `pnpm typecheck` are
  green. It is the install, not the config. `scripts/*.test.ts` is therefore unrunnable here; run it
  from a worktree.

`pnpm install --force` fixes most of it, but can die on `EPERM` unlinking
`@oxlint/binding-win32-x64-msvc/*.node`, which Zed's oxlint language servers hold open. It still
gets far enough that a following plain `pnpm install` reports a consistent state.

## `pnpm --filter client typecheck` fails in a file you did not touch

Report the exact existing error and do not chase it unless the current task requires it. If it is a
missing `tsc` module rather than a type error, see the previous section.

## `pnpm test:e2e:docker` reports success without running anything

If the run dies after the image build, the container is left in state `created`, and `docker wait`
on a never-started container returns `0` — indistinguishable from a clean pass. Verify
`.State.Status` and the test counts in the log, never the exit code alone.

## A browser check measures a different checkout's build

`pnpm --filter client preview` prints `Port 4173 is in use, trying another one... ➜
http://localhost:4174/` as one easy-to-miss line, while `:4173` keeps serving an old build from
another checkout. Nothing errors: the app renders and a manual check runs against another branch's
code. (`pnpm test:e2e` is immune: its per-worker previews use `--strictPort` on their own port
range and fail loudly on a collision.)

Read the preview's actual URL from its output rather than assuming 4173, and assert one attribute
only your branch emits as a build tell. For a deployed stack the equivalent trap is the service
worker — `docs/agent/deployment.md`.
