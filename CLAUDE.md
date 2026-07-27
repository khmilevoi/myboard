# CLAUDE.md

Canonical guidance for AI agents working in this repository. `AGENTS.md` is a symlink to this file, so Claude Code, Codex, and every other assistant read the same rules.

## Required skills

Always load and follow the `reatom` and `errore` skills before working in this repository (locally `C:\Users\Khmil\.agents\skills\reatom` and `C:\Users\Khmil\.agents\skills\errore`):

- **Reatom**: all atoms, actions, async flows, tests, and React integration in `packages/client/` and `packages/widgets/*`.
- **errore**: TypeScript errors-as-values — tagged errors, `instanceof` narrowing, flat early-return control flow, no throwing — across both `packages/client/` and `packages/server/`.

## Feature workflow

`main` is production (`rpi.toml`, deployed with `rpi deploy`). `dev` is the integration branch backed by the dev stack at `board-dev.iiskelo.com` (`rpi.dev.toml`, `rpi deploy --env dev`). Feature work never lands directly on either — it goes branch → PR into `dev` → dev deploy → PR from `dev` into `main`.

1. **Branch off `dev` in its own worktree** under `./.worktrees/<short-name>`; the main checkout stays on `dev` and is not edited while feature work is open.

   ```bash
   git fetch origin
   git worktree add .worktrees/<short-name> -b feat/<short-name> origin/dev
   cd .worktrees/<short-name>
   pnpm install
   ```

   Branch names use the same Conventional Commit prefixes as commits: `feat/`, `fix/`, `chore/`.

2. **Implement and commit inside that worktree.** Keep commits focused and imperative.

3. **Run the full gate before opening the PR**, from the worktree: `pnpm check` (lint + format:check + deps:check + typecheck + tests), plus `pnpm test:e2e:docker` when the change touches browser-facing behavior. There is no CI on this repo — these local runs _are_ the gate.

4. **Open the PR against `dev`**, never against `main`:

   ```bash
   git push -u origin feat/<short-name>
   gh pr create --base dev
   ```

   Summarize scope, list the verification commands actually run, link related issues when applicable, and attach screenshots or a short recording for UI changes.

5. **Clean up as soon as the PR is merged** — the worktree and the branch are not kept around for the release:

   ```bash
   git worktree remove .worktrees/<short-name>
   git branch -d feat/<short-name>
   git push origin --delete feat/<short-name>   # unless GitHub already deleted it on merge
   ```

6. **Deploy and test on dev.** Nothing about the deploy is automatic:

   ```bash
   rpi secrets push --env dev   # only after .env.dev changed
   rpi deploy --env dev
   ```

   The dev environment runs under the project key `myboard--dev` with its own compose project, network and Valkey volume, so its data starts empty, and WebAuthn is scoped to `board-dev.iiskelo.com` — it needs its own device invite (`rpi command create-invite --env dev`).

7. **Release.** Once dev is verified, open a PR from `dev` into `main`, merge it, and deploy production with `rpi deploy`. Keep `dev` a fast-forward ahead of `main`; do not cherry-pick individual commits into `main`.

If dev testing turns up a defect, branch off `dev` again from step 1 — never patch `main` directly. Create PRs from the exact commit range that belongs to the task; do not mix publication concerns with implementation work.

## Project structure

Private pnpm workspace with all packages under `packages/`: `browser-automation`, `client`, `server`, `shared`, `widget-runtime`, `widget-sdk`, and one package per `packages/widgets/*` directory.

- **`packages/client`** — the React/Vite board host. Source in `src`, Playwright specs in `packages/client/e2e` with page helpers in `e2e/pages`.
- **`packages/server`** — the storage API; builds to `packages/server/dist`, uses Valkey, and keeps all widget server functions in one bundle.
- **`packages/widgets/<widget-name>`** — one package per widget, each independently and optionally providing `client.ts`, `server.ts`, and `browser.ts` entry points, plus `types.ts`, `model/`, `ui/`, a federation `vite.config.ts`, and a standalone harness under `dev/` for the entry points it provides.
- **`widget-runtime`** — the singleton live runtime: storage, widget RPC, SSE/BroadcastChannel, server time, runtime contracts.
- **`widget-sdk`** — stateless Reatom/React glue and shared widget UI.
- **`browser-automation`** — the future browser service and generated task registry owner.

Client features and widgets split React/CSS/view tests into `ui/` and Reatom/domain/storage logic into `model/`. Package tests are colocated as `*.test.ts` or `*.test.tsx`. Use path aliases for absolute imports: `@/*` aliases only to `packages/client/src`, `@shared/*` to the shared package; shared widget code is imported through the `widget-runtime` / `widget-sdk` workspace package names, never through `packages/client/src`.

`packages/widgets/*/domain/` is dependency-free code shared by the widget's `model/` and its `server.ts`, and an `.oxlintrc.json` override enforces that: domain files may import only `zod`, `@shared/*`, `./` siblings and JS/Temporal globals, because the same files are bundled into the server image, which installs nothing but `packages/server`'s production dependencies.

The widget directory basename is the canonical widget ID. Each root `client.ts` exports the client definition and lazy loader without an `id`; each root `server.ts` exports schemas and handlers without a `typeId`; an optional root `browser.ts` default-exports the browser definition without a `widgetId`. Codegen injects the directory basename in each case.

## Commands

Run from the repo root with pnpm unless noted.

```bash
pnpm dev                        # codegen, then board + every widget dev server in parallel
pnpm dev:server                 # codegen, then server in watch mode
pnpm codegen:client             # widget ports, client catalog, icon map (loads root client.ts definitions)
pnpm codegen:server             # server registry from widget directory names + root server.ts, without loading client code
pnpm codegen:browser            # browser task registry from optional root browser.ts, without loading widget modules
pnpm codegen                    # client + server + browser generators, as used by workspace-wide gates
pnpm build                      # codegen, build every widget remote, then typecheck/build the client host and PWA
pnpm build:widgets              # codegen, then build widget remotes only
pnpm --filter server build      # bundle server with Rspack
pnpm test                       # all workspace Vitest tests
pnpm --filter client test       # client tests only
pnpm --filter server test       # server tests only
pnpm test:e2e                   # board Playwright e2e against the assembled production-style Vite output; needs a reachable Valkey at VALKEY_URL (e.g. `pnpm start:docker`) and ALLOW_TEST_DB_RESET=1 set
pnpm test:e2e:docker            # same suite, fully isolated: ephemeral Valkey + browsers in one container, torn down after
pnpm test:e2e:docker:down       # tear down the containerized e2e stack
pnpm test:e2e:docker:headed     # dockerized Valkey + host Playwright in headed mode
pnpm test:e2e:nginx             # gate + nginx image tests; needs `ALLOW_TEST_DB_RESET=1 pnpm start:docker` running
pnpm typecheck                  # workspace-wide tsc --noEmit
pnpm lint / pnpm lint:fix       # oxlint
pnpm format / pnpm format:check # oxfmt
pnpm deps:check                 # syncpack lint
pnpm check                      # lint + format:check + deps:check + typecheck + test, run together (full local gate)
pnpm dev:docker                 # Valkey + server + client with hot reload
pnpm start:docker               # production-style Docker stack
```

Run a single test file or test name with Vitest directly, e.g.:

```bash
pnpm --filter client exec vitest run src/widget-registry/model/registry.test.ts
pnpm --filter client exec vitest run -t "test name substring"
pnpm --filter client test -- src/board/model/board-storage.test.ts
```

Playwright specs (`packages/client/e2e`) can be filtered the same way:

```bash
pnpm --filter client exec playwright test e2e/<file>.spec.ts
```

### Windows / shell notes

- Run all `pnpm`, `node`, `npm`, and `corepack` commands outside Codex's default sandbox with escalated permissions. In this environment the executables live under `C:\nvm4w\nodejs` and `C:\Users\Khmil\AppData\Local\pnpm`, and sandboxed runs can fail with `pnpm` not found or `Access is denied`.
- `rg` may be unavailable in this shell. If so, use PowerShell-native discovery such as `Get-ChildItem -Recurse`, `Select-String`, and `Get-Content` instead of spending time fixing PATH.
- Vitest path filters for client tests are relative to `packages/client`, not the repository root. Use `pnpm --filter client test -- src/board/model/board-storage.test.ts`, not `packages/client/src/...`.
- If `pnpm --filter client test -- <file>` hangs or hides useful output, run the client Vitest entrypoint directly from `packages/client` with the Visual Studio Node 20 binary:
  `& 'C:\Program Files\Microsoft Visual Studio\2022\Community\Msbuild\Microsoft\VisualStudio\NodeJs\node.exe' .\node_modules\vitest\vitest.mjs run src/board/model/board-storage.test.ts --reporter verbose`
- The workspace requires Node 26 (`engines.node: ">=26"`), where `Temporal` is an unflagged global. No Vitest config passes `--harmony-temporal` any more, so a missing `Temporal` means the wrong Node is on PATH, not a missing flag.
- If a model-only test fails during jsdom worker startup with `ERR_REQUIRE_ESM` from `html-encoding-sniffer` / `@exodus/bytes`, prefer `// @vitest-environment node` for that test file. If importing storage code creates Dexie, add `import 'fake-indexeddb/auto'` before importing the model.
- For Reatom model tests that call `context.reset()`, module-level `effect(...)` subscriptions are aborted. Export the effect when it is part of the behavior under test, subscribe in `beforeEach`, and unsubscribe in `afterEach`.
- Reatom effects run through Reatom queues. When asserting effect-driven changes, use `vi.waitFor(...)` or `schedule(() => undefined)` from `@reatom/core` to flush the queue before the assertion.
- If `pnpm --filter client typecheck` fails in an unrelated file, report the exact existing error and do not chase it unless the current task requires it.

## Architecture

### Widget system

- **`packages/client/src/widget-registry`**: synchronous codegen-generated catalog metadata and icon map. Only `loadComponent` crosses the Module Federation boundary when a placed widget mounts.
- **`packages/widgets/<widget-name>`**: one pnpm package per widget, split into `model/` and `ui/`, exposing only `./ui` as a federation remote and providing a standalone `dev/` harness. Adding a widget package and running codegen updates the client catalog, server registry, and stable port map without editing a hand-written registry.
- **`packages/client/src/widget-host`**: mounts first-party widget components in the board React tree and provides frame/error-boundary/fullscreen behavior.
- **`widget-runtime` / `widget-sdk`**: shared runtime contracts/connections and stateless React/UI helpers respectively. React, React DOM, Reatom, and `widget-runtime` are strict federation singletons.

Widgets that write shared state do it from their own `server.ts` rather than through
`/api/storage/:key/append`: the widget dispatch route resolves the session cookie into
`WidgetServerContext.viewer`, so the record's author is stamped by the server from the caller's own
session and never travels in the request body. The UI therefore cannot sign a record with someone
else's name. This is not an authorization boundary: `POST /api/storage/:key/append` is still
reachable by anyone nginx has already let in, and it writes the body as given, so a signed-in
household member can hand-write a record carrying any author into a widget's key. The generic
storage route stays a shared trusted channel inside the board.
`WidgetRuntimeProps.identity` gives the client side the same roster (`GET /api/auth/accounts`) for
display — records store an `accountId` plus a frozen name, and display resolves through the
directory so renames and avatars reach old records.

A widget's `server.ts` may also declare `crons: { <name>: { schedule, timeZone, run } }`. The tick
scheduler in `packages/server/src/widgets/cron-scheduler.ts` runs them on the app's injected clock,
keeps a cursor per job at `cron:<typeId>:<jobName>` in Valkey, and catches a missed occurrence up
exactly once — so handlers must be idempotent. A cron context has no `viewer` and no instance
scope: a background run has no caller, so a job that writes an authored record supplies the author
itself. In test mode the interval is off and `POST /api/test/cron/tick` drives one pass.

### Storage system (offline-first + sync)

`packages/widget-runtime/src/storage` owns per-widget instance/shared scopes, Dexie and HTTP backends, SSE/BroadcastChannel fanout, and Reatom bindings. Board and standalone harnesses construct the same `WidgetRuntimeProps`; widgets do not import storage through `packages/client/src`.

> ⚠️ **Storage keys are a persistence contract — never change how a key is derived without a data migration.** Keys are `namespace + relativeKey` where the namespace comes from `instanceNamespace`/`typeNamespace` (`packages/shared/storage/scope.ts`) and the `scopeWithColon` normalization in `makeScopedStorage` (`packages/widget-runtime/src/widget-api.ts`). Any edit to the scope prefix, separator (e.g. the colon), `instanceId`/`typeId` values, or a widget's `relativeKey` **silently orphans all existing data**: deployed clients read the new key, get a 404 → fall back to the empty default, and the old data sits unreachable under the previous key in Valkey/IndexedDB. This already bit us once — commit `0027a99` "stop doubling the colon in scoped storage keys" changed `w:t:<id>::` → `w:t:<id>:` and wiped every widget's shared/instance state on deploy (the `root:`-scoped board survived only because its namespace never had the trailing colon). If you must change a key shape, ship a one-time migration (rename old keys → new) in the same release, or key data will vanish for users on the next deploy.

### Server (storage API)

`packages/server/src/index.ts` is a plain `node:http` server routed with `find-my-way`, backed by Valkey (Redis-compatible):

- REST-ish endpoints under `/api/storage` (`GET`/`PUT`/`DELETE` by key, prefix listing, atomic `append` via `runExclusive` per-key locking in `storage/key-lock.ts`).
- `GET /api/storage/events` opens an SSE stream; clients `POST /api/storage/events/:connId` to subscribe/unsubscribe to key prefixes. Server-side fanout (`realtime/sse.ts`) is driven by a Valkey pub/sub subscriber on the `storage:events` channel, so writes from any server instance reach all connected SSE clients.
- All request/response bodies are validated with Zod schemas (`storage/schemas.ts`); validation failures return 422 with a formatted Zod error.
- Errors and control flow follow the errore pattern (tagged errors / `Error | T` unions) rather than throwing.

## Coding style & naming conventions

Use TypeScript and ESM imports. Follow the existing style: 2-space indentation, single quotes, no semicolons, named exports, and CSS Modules named `*.module.css`. React components use PascalCase filenames such as `Header.tsx`; utility modules use kebab-case or domain names such as `board-storage.ts`. Widget directories use kebab-case.

All exported React function components in `packages/client/src` and `packages/widgets/*` must be defined with `reatomMemo` from `widget-sdk` (normally `widget-sdk/reatom/reatom-memo`). This is a hard rule: use `reatomMemo` even for simple presentational components so every component has the same Reatom integration and React memo wrapper. Keep business logic, derived state, timers, async flows, and cross-component UI state in `model/` Reatom atoms/actions/computeds; leave only refs, DOM interop, and truly tiny view glue in `ui/`. For React error boundaries, keep the class implementation internal and export a `reatomMemo` wrapper component.

## UI gotchas

Stacked Radix `Dialog`/`AlertDialog`/`Popover` roots (two sibling `Root` instances open at once, not DOM-nested) are prone to a known `DismissableLayer` race: closing the top one via its own close button/escape/outside-click can also dismiss the one underneath, because the underlying root's deferred `pointerDownOutside` check (`deferPointerDownOutside` → `setTimeout(0)`) runs after the top root has already unregistered from Radix's shared "topmost" layer stack. A reactive open-state guard does not fix this (the state has already flipped by the time the deferred check runs); only a plain ref cleared one tick later works, and even that is coupled to Radix's internal event timing.

If this resurfaces, treat it as an architectural decision, not another timing patch: first consider collapsing the stack into a single `Dialog.Root` with an internal view/content switch (no second `Root` needed, so the race cannot occur), before reaching for another ref-based guard.

## Testing guidelines

Vitest is the unit/component test runner; React tests use Testing Library and jsdom. Keep tests near the code they verify as `*.test.ts` or `*.test.tsx`. Playwright specs belong in `packages/client/e2e`, with page helpers in `packages/client/e2e/pages`. Run `pnpm check` (or `pnpm test` and `pnpm typecheck`) before opening a PR; run `pnpm test:e2e` for browser-facing behavior.

## Commits

Recent history uses Conventional Commit prefixes, including `feat:`, `fix:`, `build:`, and `chore:`, optionally scoped (`fix(client): …`). Keep commits focused and imperative, for example `fix: random key generation`. PR expectations are part of the [feature workflow](#feature-workflow) above.

## Security & configuration

Do not commit `.env` files. Client environment examples live in `packages/client/.env.example`; server configuration uses `PORT` and `VALKEY_URL`. Prefer Docker commands when changes depend on Valkey or the full client/server stack.

## Deployment

`pi.toml` configures deployment to a Raspberry Pi target via `docker-compose.yml`, with the `client` service as the ingress (port 80) and a generous 30-minute build timeout (SPA build + server image build is slow on Pi hardware). The client image builds every widget remote first, stages them under `/widgets/<id>/`, and precaches them in the same PWA release. `rpi.dev.toml` overlays that configuration for the `dev` environment (see the [feature workflow](#feature-workflow)).

Three deploy targets, each with its own hostname, Valkey volume and device invite:

```bash
pnpm run deploy          # production, board.iiskelo.com          (rpi.toml)
pnpm run deploy:dev      # dev integration, board-dev.iiskelo.com (rpi.dev.toml)
pnpm run deploy:branch   # current branch, board-branch.iiskelo.com (rpi.branch.toml)
```

Use `pnpm run deploy`, not `pnpm deploy` — the latter is pnpm's own built-in command and never reaches the script.

`rpi.branch.toml` is one shared stand for trying the checked-out branch on real hardware, not one stack per branch. `source.branch` resolves through `${git.branch}`, so rpi reads the branch out of the checkout and no `--vars` are passed anywhere — `pnpm run deploy:branch`, `rpi command … --env branch` and `rpi env destroy branch` all take the environment alone. Since rpi 0.27 the environment key gets a per-branch suffix only when the configuration references `${env.slug}`; nothing in `rpi.branch.toml` does, so every branch deploys onto the key `myboard--branch` behind `board-branch.iiskelo.com`, keeping the same volumes: the test device stays invited and board data survives a branch switch, but the previous branch's service worker, IndexedDB and Valkey contents are still there afterwards (`rpi env reset-data branch` wipes the volumes). `rpi config show --env branch` prints a warning about the shared key — that is the intended configuration, not drift. The environment carries `ttl = "72h"`, so a stand nobody redeploys reaps itself.

The stand's own configuration lives in the `branch` secret group rather than in the environment's bundle, which stays empty. Two things follow. Groups belong to the base project, so neither `rpi env destroy branch` nor the TTL reaper takes it down with the stand — one that reaped itself is still configured when it is deployed again. And a *declared* group that is missing or empty fails the deploy at the layer-load step, before the checkout is written and long before the ~3-minute image build, naming the group and the push that fixes it — where a missing bundle of its own would have deployed silently unconfigured, with the WebAuthn gate on production's hostname and this stack fighting the others for their host ports. That is why `deploy:branch` is a bare `rpi deploy --env branch` and needs no script around it. A rebuilt branch project does get a fresh deploy key, and the first deploy can lose the race between registering it on GitHub and cloning — if `git clone` fails with `Permission denied (publickey)`, just run the command again.

Secrets reach the three stacks through groups rather than per-environment bundles. `rpi.toml` attaches `prod`, `rpi.dev.toml` attaches `dev`, `rpi.branch.toml` attaches `["dev", "branch"]`; `[secrets].files` is cleared in both overlays, and `[secrets].env`/`files` in each file is the local source a push reads, never a deploy-time input. Push each group once, from the repository root except where noted:

```bash
rpi secrets push --group prod                    # .env + the passport-checker files
rpi secrets push --group dev                     # the same files, for dev and the branch stand
rpi secrets push --group branch --env branch     # .env.branch, the stand's own configuration
```

Layers apply in the order declared and merge per variable and per file path, with the environment's own bundle always last — so `branch` overrides `dev`, and anything pushed to a deploy key overrides both. A declared group that is missing **or empty** fails the deploy naming the group; only the deploy key's own bundle may be empty. `rpi secrets ls [--env <env>]` shows which layer wins every entry (`<- group branch`, `<- key`). `rpi secrets send` still works but is a deprecated alias for `rpi secrets push`.

Extra flags reach the CLI without a separator — `pnpm run deploy:branch --cancel`, `pnpm run deploy:branch --server home`. Do not add `--`: pnpm forwards the separator itself into the command, and rpi's parser reads a bare `--` as end-of-flags, so everything after it lands as a positional and is rejected.

## Failure modes to avoid

- Keep the scope tight. Do not spend time re-reading plans, skills, or history once the actual code change is localized.
- Do not use subagents when a task is already reduced to a small, single-file or two-file edit. Delegate only when it reduces complexity.
- Verify in the correct workspace and cwd. If a test runner or package manager fails because of the shell environment, fix the invocation once and move on.
- Do not mix publication concerns with implementation work. Create PRs from the exact commit range that belongs to the task.
- Stop when the code, tests, and typecheck are green. Do not keep expanding the process after the required checks pass.
