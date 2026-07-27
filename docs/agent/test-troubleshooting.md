# Running tests and tooling on this machine

Symptom-indexed. Everything here is about the local environment, not about the code under test.

## `pnpm` / `node` not found, or `Access is denied`

Run all `pnpm`, `node`, `npm` and `corepack` commands outside Codex's default sandbox with escalated
permissions. In this environment the executables live under `C:\nvm4w\nodejs` and
`C:\Users\Khmil\AppData\Local\pnpm`, and sandboxed runs fail with exactly these two errors.

## `rg` is unavailable

Use PowerShell-native discovery — `Get-ChildItem -Recurse`, `Select-String`, `Get-Content` — instead
of spending time fixing PATH.

## A Vitest path filter matches nothing

Client test paths are relative to `packages/client`, not the repository root. Use
`pnpm --filter client test -- src/board/model/board-storage.test.ts`, not `packages/client/src/...`.

## `pnpm --filter client test -- <file>` hangs or hides useful output

Run the client Vitest entrypoint directly from `packages/client`:

```powershell
& 'C:\Program Files\Microsoft Visual Studio\2022\Community\Msbuild\Microsoft\VisualStudio\NodeJs\node.exe' .\node_modules\vitest\vitest.mjs run src/board/model/board-storage.test.ts --reporter verbose
```

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

## `pnpm --filter client typecheck` fails in a file you did not touch

Report the exact existing error and do not chase it unless the current task requires it.
