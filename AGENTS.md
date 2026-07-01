# Repository Guidelines

## Agent-Specific Instructions

Always load and follow `C:\Users\Khmil\.agents\skills\reatom` and `C:\Users\Khmil\.agents\skills\errore` before working in this repository. Use Reatom for atoms, actions, async flows, tests, and React integration; use errore for TypeScript errors-as-values, tagged errors, and flat early-return control flow.

## Project Structure & Module Organization

This is a private pnpm workspace with `client`, `server`, `shared`, `widget-runtime`, `widget-sdk`, and one package per `widgets/*` directory. The React/Vite board lives in `client/src`; widget implementations live in `widgets/<widget-name>` and each owns `client.ts`, `server.ts`, `types.ts`, `model/`, `ui/`, a federation `vite.config.ts`, and a standalone harness under `dev/`. `widget-runtime` owns the singleton live runtime (storage, widget RPC, SSE/BroadcastChannel, server time, runtime contracts); `widget-sdk` owns stateless Reatom/React glue and shared widget UI. Client features and widgets split React/CSS/view tests into `ui/` and Reatom/domain/storage logic into `model/`. Client e2e tests live in `client/e2e`; package tests are colocated as `*.test.ts` or `*.test.tsx`. The storage API lives in `server/src`, builds to `server/dist`, uses Valkey, and keeps all widget server functions in one bundle.

## Build, Test, and Development Commands

Use pnpm from the repository root.
Run all `pnpm`, `node`, `npm`, and `corepack` commands outside Codex's default sandbox with escalated permissions. In this environment the executables live under `C:\nvm4w\nodejs` and `C:\Users\Khmil\AppData\Local\pnpm`, and sandboxed runs can fail with `pnpm` not found or `Access is denied`.

- `pnpm dev`: run codegen, then start the board and every widget dev server in parallel.
- `pnpm dev:server`: run codegen, then start the server in watch mode.
- `pnpm build`: run codegen, build every widget remote, then typecheck/build the client host and PWA.
- `pnpm --filter server build`: bundle server with Rspack.
- `pnpm test`: run workspace Vitest tests.
- `pnpm --filter client test -- src/board/model/board-storage.test.ts`: run a specific client Vitest file, using a path relative to `client`.
- `pnpm test:e2e`: run board Playwright tests against the assembled production-style Vite output.
- `pnpm --filter client test:e2e:nginx`: with `docker compose up --build -d` running, smoke-test the actual nginx image.
- `pnpm typecheck`: run workspace TypeScript checks.
- `pnpm docker:dev`: run Valkey, server, and client with hot reload.
- `pnpm docker:up`: build and run the production-style Docker stack.

### Windows Test Runner Notes

- `rg` may be unavailable in this shell. If so, use PowerShell-native discovery such as `Get-ChildItem -Recurse`, `Select-String`, and `Get-Content` instead of spending time fixing PATH.
- Vitest path filters for client tests are relative to `client`, not the repository root. Use `pnpm --filter client test -- src/board/model/board-storage.test.ts`, not `client/src/...`.
- If `pnpm --filter client test -- <file>` hangs or hides useful output, run the client Vitest entrypoint directly from `client` with the Visual Studio Node 20 binary:
  `& 'C:\Program Files\Microsoft Visual Studio\2022\Community\Msbuild\Microsoft\VisualStudio\NodeJs\node.exe' .\node_modules\vitest\vitest.mjs run src/board/model/board-storage.test.ts --reporter verbose`
- Avoid switching targeted unit tests to `--pool vmThreads` as a first response: this repo's Vitest config passes `--harmony-temporal`, which can be invalid for worker threads in this environment.
- If a model-only test fails during jsdom worker startup with `ERR_REQUIRE_ESM` from `html-encoding-sniffer` / `@exodus/bytes`, prefer `// @vitest-environment node` for that test file. If importing storage code creates Dexie, add `import 'fake-indexeddb/auto'` before importing the model.
- For Reatom model tests that call `context.reset()`, module-level `effect(...)` subscriptions are aborted. Export the effect when it is part of the behavior under test, subscribe in `beforeEach`, and unsubscribe in `afterEach`.
- Reatom effects run through Reatom queues. When asserting effect-driven changes, use `vi.waitFor(...)` or `schedule(() => undefined)` from `@reatom/core` to flush the queue before the assertion.
- If `pnpm --filter client typecheck` fails in an unrelated file, report the exact existing error and do not chase it unless the current task requires it.

## Coding Style & Naming Conventions

Use TypeScript and ESM imports. Follow the existing style: 2-space indentation, single quotes, no semicolons, named exports, and CSS Modules named `*.module.css`. React components use PascalCase filenames such as `Header.tsx`; utility modules use kebab-case or domain names such as `board-storage.ts`. Widget directories use kebab-case.

All exported React function components in `client/src` and `widgets/*` must be defined with `reatomMemo` from `widget-sdk` (normally `widget-sdk/reatom/reatom-memo`). This is a hard rule: use `reatomMemo` even for simple presentational components so every component has the same Reatom integration and React memo wrapper. Keep business logic, derived state, timers, async flows, and cross-component UI state in `model/` Reatom atoms/actions/computeds; leave only refs, DOM interop, and truly tiny view glue in `ui/`. For React error boundaries, keep the class implementation internal and export a `reatomMemo` wrapper component.

## Testing Guidelines

Vitest is the unit/component test runner; React tests use Testing Library and jsdom. Keep tests near the code they verify as `*.test.ts` or `*.test.tsx`. Playwright specs belong in `client/e2e`, with page helpers in `client/e2e/pages`. Run `pnpm test` and `pnpm typecheck` before opening a PR; run `pnpm test:e2e` for browser-facing behavior.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commit prefixes, including `fix:`, `build:`, and `chore:`. Keep commits focused and imperative, for example `fix: random key generation`. PRs should summarize scope, list verification commands, link related issues when applicable, and include screenshots or short recordings for UI changes.

## Security & Configuration Tips

Do not commit `.env` files. Client environment examples live in `client/.env.example`; server configuration uses `PORT` and `VALKEY_URL`. Prefer Docker commands when changes depend on Valkey or the full client/server stack.

## General Guidelines

- For worktrees you should use `./.worktrees` folder
- Use path aliases for absolute imports like `@/*` or `@shared/*`

## Failure Modes to Avoid

- Keep the scope tight. Do not spend time re-reading plans, skills, or history once the actual code change is localized.
- Do not use subagents when a task is already reduced to a small, single-file or two-file edit. Delegate only when it reduces complexity.
- Verify in the correct workspace and cwd. If a test runner or package manager fails because of the shell environment, fix the invocation once and move on.
- Do not mix publication concerns with implementation work. Create PRs from the exact commit range that belongs to the task.
- Stop when the code, tests, and typecheck are green. Do not keep expanding the process after the required checks pass.
