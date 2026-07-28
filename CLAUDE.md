# CLAUDE.md

Canonical guidance for AI agents working in this repository. `AGENTS.md` is a symlink to this file,
so Claude Code, Codex, and every other assistant read the same rules.

Detail that is only needed sometimes lives next to the code. Claude Code exposes the first four as
skills and loads them on demand; other agents read the files directly.

| Guide | Read it when |
| --- | --- |
| `docs/agent/deployment.md` | deploying, pushing secrets, editing `rpi*.toml`, using the branch stand, releasing `dev` into `main` |
| `docs/agent/test-troubleshooting.md` | a test run or a pnpm/node invocation misbehaves on this machine |
| `docs/agent/widget-server.md` | writing a widget's `server.ts`, a cron job, or code that stamps a record's author |
| `docs/agent/radix-stacked-dialogs.md` | closing one Radix dialog or popover also dismisses the one underneath |
| `docs/agent/browser-history-traversal.md` | touching `overlay-history.ts`, or a test disagrees with the browser about history traversal timing |
| `docs/architecture/overview.md` | you need the widget/storage/server picture beyond the map below |

## Required skills

- **reatom** — every atom, action, async flow, test and React integration in `packages/client/` and
  `packages/widgets/*`.
- **errore** — TypeScript errors-as-values (tagged errors, `instanceof` narrowing, flat early
  returns, no throwing) across `packages/client/` and `packages/server/`.

## Feature workflow

`main` is production and `dev` is the integration branch. Feature work never lands directly on
either — it goes branch → PR into `dev` → dev deploy → PR from `dev` into `main`.

1. **Branch off `dev` in its own worktree** under `./.worktrees/<short-name>`; the main checkout
   stays on `dev` and is not edited while feature work is open.

   ```bash
   git fetch origin
   git -c core.symlinks=false worktree add .worktrees/<short-name> -b feat/<short-name> origin/dev
   git -C .worktrees/<short-name> update-index --skip-worktree AGENTS.md
   cd .worktrees/<short-name>
   pnpm install
   ```

   `AGENTS.md` is a committed symlink that Windows cannot materialize, so both git flags are
   required — without them the command fails outright or leaves a permanent ` T ` typechange.
   Branch names use the same Conventional Commit prefixes as commits: `feat/`, `fix/`, `chore/`.

2. **Implement and commit inside that worktree.**

3. **Run the full gate before opening the PR**, from the worktree: `pnpm check`, plus
   `pnpm test:e2e:docker` when the change touches browser-facing behavior. There is no CI on this
   repo — these local runs _are_ the gate.

4. **Open the PR against `dev`**, never against `main`:
   `git push -u origin feat/<short-name> && gh pr create --base dev`. Summarize scope, list the
   verification commands actually run, link related issues, and attach screenshots or a short
   recording for UI changes.

5. **Clean up the worktree, deploy to dev, then release** — `docs/agent/deployment.md`.

If dev testing turns up a defect, branch off `dev` again from step 1 — never patch `main` directly.
Create PRs from the exact commit range that belongs to the task; do not mix publication concerns
with implementation work.

## Project structure

Private pnpm workspace, everything under `packages/`: `client` (React/Vite board host, source in
`src`, Playwright specs in `e2e` with page helpers in `e2e/pages`), `server` (the storage API on
Valkey, bundled to `dist` with every widget server function in it), `shared`, `widget-runtime` (the
singleton live runtime: storage, widget RPC, SSE/BroadcastChannel, server time, contracts),
`widget-sdk` (stateless Reatom/React glue and shared widget UI), `browser-automation` (the browser
service and generated task registry), and one package per `packages/widgets/*`.

The non-obvious rules:

- Client features and widgets split React/CSS/view tests into `ui/` and Reatom/domain/storage logic
  into `model/`. Tests are colocated as `*.test.ts` or `*.test.tsx`.
- `@/*` aliases only to `packages/client/src`, `@shared/*` to the shared package. Shared widget code
  is imported through the `widget-runtime` / `widget-sdk` package names, never through
  `packages/client/src`.
- `packages/widgets/*/domain/` is dependency-free code shared by a widget's `model/` and its
  `server.ts`; the `.oxlintrc.json` override enforces its import allowlist, because those files are
  bundled into the server image.
- The widget directory basename is the canonical widget ID. Root `client.ts`, `server.ts` and the
  optional `browser.ts` export their definitions **without** an `id` / `typeId` / `widgetId` —
  codegen injects the basename. A widget package also carries `types.ts`, a federation
  `vite.config.ts`, and a standalone `dev/` harness for the entry points it provides.

## Commands

Run from the repo root. `package.json` holds the full list; these are the ones worth knowing.

```bash
pnpm dev                 # codegen, then board + every widget dev server in parallel
pnpm dev:server          # codegen, then server in watch mode
pnpm codegen             # client catalog + server registry + browser task registry
pnpm check               # lint + format:check + deps:check + typecheck + test (the full local gate)
pnpm test                # codegen, then all workspace Vitest tests
pnpm typecheck           # codegen, then workspace-wide tsc --noEmit
pnpm build               # codegen, every widget remote, then the client host and PWA
pnpm test:e2e:docker     # board Playwright e2e, fully isolated (ephemeral Valkey + browsers)
pnpm start:docker        # production-style Docker stack (pnpm dev:docker for hot reload)
```

`pnpm test:e2e` runs the same suite against a host-run stack and needs a reachable Valkey at
`VALKEY_URL` plus `ALLOW_TEST_DB_RESET=1`. `pnpm test:e2e:nginx` adds the gate and nginx image tests
on top of a running `ALLOW_TEST_DB_RESET=1 pnpm start:docker`.

Filtering a single test — the paths are relative to the package, not the repo root:

```bash
pnpm --filter client exec vitest run src/board/model/board-storage.test.ts
pnpm --filter client exec vitest run -t "test name substring"
pnpm --filter client exec playwright test e2e/<file>.spec.ts
```

If any of this misbehaves on this machine, read `docs/agent/test-troubleshooting.md` before
debugging the invocation.

## Architecture

- **`packages/client/src/widget-registry`** — synchronous codegen-generated catalog metadata and
  icon map. Only `loadComponent` crosses the Module Federation boundary, when a placed widget mounts.
- **`packages/client/src/widget-host`** — mounts widget components in the board React tree; frame,
  error boundary, fullscreen.
- **`packages/widgets/<name>`** — one package per widget, exposing only `./ui` as a federation
  remote. React, React DOM, Reatom and `widget-runtime` are strict federation singletons.
- **`packages/widget-runtime/src/storage`** — per-widget instance/shared scopes, Dexie and HTTP
  backends, SSE/BroadcastChannel fanout, Reatom bindings. Board and harnesses construct the same
  `WidgetRuntimeProps`.
- **`packages/server/src/index.ts`** — plain `node:http` routed with `find-my-way` over Valkey:
  `/api/storage` REST with atomic `append` under per-key locking, an SSE stream fanned out through
  Valkey pub/sub, Zod-validated bodies (422 on failure), errore-style control flow.

> ⚠️ **Storage keys are a persistence contract.** Changing how a key is derived silently orphans all
> existing data. The rules, and the incident that proves it, are in the header comment of
> `packages/shared/storage/scope.ts` — read it before touching a namespace, a separator, or a
> widget's `relativeKey`.

Widget `server.ts` handlers, crons and authored records: `docs/agent/widget-server.md`.

## Coding style & naming conventions

TypeScript and ESM imports, named exports, CSS Modules named `*.module.css`. Formatting is `oxfmt`'s
job — run it, do not hand-tune it. React components use PascalCase filenames such as `Header.tsx`;
utility modules use kebab-case or domain names such as `board-storage.ts`. Widget directories use
kebab-case.

All exported React function components in `packages/client/src` and `packages/widgets/*` must be
defined with `reatomMemo` from `widget-sdk` (normally `widget-sdk/reatom/reatom-memo`). This is a
hard rule: use it even for simple presentational components, so every component has the same Reatom
integration and React memo wrapper. Keep business logic, derived state, timers, async flows and
cross-component UI state in `model/` atoms/actions/computeds; leave only refs, DOM interop and truly
tiny view glue in `ui/`. For React error boundaries, keep the class implementation internal and
export a `reatomMemo` wrapper component.

## Testing

Vitest for unit and component tests (Testing Library + jsdom for React), Playwright for e2e.

## Commits

Conventional Commit prefixes — `feat:`, `fix:`, `build:`, `chore:` — optionally scoped
(`fix(client): …`). Keep commits focused and imperative, for example `fix: random key generation`.
PR expectations are part of the [feature workflow](#feature-workflow) above.

## Security & configuration

Do not commit `.env` files. Client environment examples live in `packages/client/.env.example`;
server configuration uses `PORT` and `VALKEY_URL`. Prefer Docker commands when changes depend on
Valkey or the full client/server stack.
