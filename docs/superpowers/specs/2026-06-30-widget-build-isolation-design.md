# Widget Build Isolation Design

**Date:** 2026-06-30
**Status:** Approved

## Goal

Each widget builds as an independent artifact instead of being statically
bundled into the client app's own module graph. Development stays fast and
reactive (HMR across widget and board edits). Each widget can run standalone,
outside the board, against a real running server, using the same
host-supplied API (storage, widget RPC) the board normally injects.

This builds directly on `2026-06-30-widget-server-functions-design.md`, which
established per-widget `client.ts` / `server.ts` / `types.ts` entrypoints and
explicitly deferred two things as not yet needed: automatic widget discovery
and per-widget workspace packages. This design picks up both, because the
build-isolation requirement is exactly the need that was missing then.

## Scope

- Convert `widgets/<name>` into independent pnpm workspace packages.
- Give each widget's client UI an independent production build artifact,
  composed into the board at runtime rather than bundled at board build time.
- Extract the host-supplied client API (storage, widget RPC) into a new
  `widget-runtime` package, shared by the board and by standalone widget
  dev/preview entrypoints.
- Add a standalone dev entrypoint per widget that mounts it directly against
  a real running server.
- Replace the three hand-maintained widget lists (client registry, server
  registry, host remote config) with a single build-time codegen step.
- Keep the server-side widget functions in one Node bundle; no server-side
  runtime isolation is introduced.

Out of scope is listed at the end of this document.

## Chosen Approach

### Build-time isolation only, no runtime sandbox

The project previously had true runtime isolation: each widget had its own
`index.html` / `main.tsx` entry, rendered in an iframe, communicating with the
board through a structured `postMessage` bridge. It was removed
(`refactor(widgets): remove iframe bridge runtime`) in favor of widgets as
first-party React components receiving typed props directly, because the
iframe bridge added complexity and weakened type safety without the project
needing a trust boundary between board and widgets.

This design does not reintroduce a runtime sandbox. Widgets keep rendering as
ordinary React components inside the board's own React tree and DOM, with the
same `WidgetRuntimeProps` contract as today. Isolation here is scoped to the
build and dev/preview workflow, not the browser runtime.

### Independent production artifacts via Module Federation

Build-time isolation is interpreted literally: each widget produces its own
versioned build output (own `vite build` invocation, own `dist/`), not just a
lazy-loaded chunk inside the client app's single build graph (which is what
today's `import()`-based code splitting already gives, and was judged
insufficient).

Because the widget still renders inside the board's own React tree, `react`,
`react-dom`, `@reatom/core`, and `@reatom/react` must be the same module
instance across board and widget — otherwise hooks break (a widget bundle
with its own copy of `react` reads a hooks dispatcher that the board's
renderer never sets). This is a hard correctness constraint, not a tuning
option.

`@module-federation/vite` (peer range includes `vite: ^8.0.0`) is used to
manage this: each widget is a federation **remote** exposing its `client.ts`;
the board is the federation **host** that consumes widgets as remotes and
declares `react`, `react-dom`, `@reatom/core`, `@reatom/react`, and
`widget-runtime` as shared singletons. In production, the plugin resolves
remotes from prebuilt assets.

**Confirmed by spike (2026-06-30).** A throwaway host/remote pair was built
with this project's exact dependency versions (`vite@8.0.16` with its
`rolldown` dependency, `@vitejs/plugin-react@6.0.2`, `react@19.2.7`,
`@reatom/core@1001.1.0`, `@reatom/react@1001.0.0`,
`@module-federation/vite@1.16.12`). Both `vite build` (remote and host) and
`vite preview` succeeded cleanly under Rolldown. In a real browser, a
federation remote rendered inside the host's own React tree, with the host
and remote each independently exercising a `useState` hook and a
`@reatom/core` atom — all four counters tracked clicks correctly with no
"Invalid hook call" or duplicate-dispatcher errors, confirming shared
singletons work end to end. **Decision: go.** No fallback is needed.

**HMR fix confirmed (2026-07-01).** The first spike pass set `dev: {
remoteHmr: true }` only on the host's federation config. With only the host
configured, editing the remote's source fired `[vite] hot updated: <file>`
and preserved component state, but the new JSX was not reflected in the
rendered output for components wrapped the way this project wraps them,
`memo(reatomComponent(fn, name))` — and the same stale-render symptom
reproduced even for the host's own local components, with no remote or
federation boundary involved at all.

The fix is to set `dev: { remoteHmr: true }` on **both** the host's and
every remote's federation config, not just the host's. Re-tested after
applying this on both sides: editing the remote's source now updates the
rendered output live, `useState` state is preserved across the edit (no full
reload), and the same is true for edits to the host's own local components.
This was re-verified across two more edit/click cycles for stability.

One residual nuance, expected rather than a bug: a `@reatom/core` atom
defined at module scope (e.g. `const counterAtom = atom(0, '...')`, outside
the component) resets to its initial value on each HMR update of the module
that defines it, even though the component's own `useState` hook state
survives. The module re-evaluates on HMR, so a fresh atom instance is
created — the same thing would happen to any plain module-level variable.
React hook state survives because React Fast Refresh preserves it
per-component-instance; module-level reatom state does not get the same
treatment. This is not specific to federation and applies equally to today's
plain (non-federated) widgets.

**Action for implementation:** when wiring federation `vite.config.ts` for
the board and each widget remote (Phased Rollout step 3), set `dev: {
remoteHmr: true }` symmetrically on every config, not only the host's.

### Server stays a single bundle

Node has no equivalent of the browser's "two copies of React in one render
tree" problem — one process, one module cache. `server.ts` files continue to
bundle into one Rspack output as they do today. Splitting the server build
per widget would add deployment complexity (multiple processes/ports, routing
between them) that nothing in this design's goals calls for.

## Package Structure

```text
widgets/
  clock/
    package.json          # new: own deps, own scripts
    vite.config.ts         # federation({ name: 'clock', exposes: {...}, shared: [...] })
    client.ts / server.ts / types.ts
    model/ ui/ server/
    dev/
      index.html
      main.tsx             # standalone harness, see below
  ofelia-poop-duty/
    ... same shape
widget-runtime/             # new package, sibling of client/server/shared/widgets
  package.json
  src/
    storage.ts              # makeWidgetStorage (Dexie + HTTP backend)
    widget-api.ts           # makeWidgetApi (HTTP RPC client)
    types.ts                # WidgetRuntimeProps and related contract types
```

`pnpm-workspace.yaml` changes `widgets` to the glob `widgets/*`, and adds
`widget-runtime`.

## Widget Runtime Package

`client/src/storage` and `client/src/widget-api` currently implement the
host-supplied API (`WidgetStorage`, `WidgetApi`) but live inside the board
app, unreachable from a standalone widget entry. They move into
`widget-runtime`, along with the `WidgetRuntimeProps` type currently in
`client/src/widget-host/model/types.ts`. The board and every widget's
standalone dev entry depend on this package and get the same bridge
implementation — no duplicated storage/transport code, and no risk of the
standalone harness drifting from what the board actually injects.

`widget-runtime` is marked as a federation-shared singleton: it holds live
SSE and `BroadcastChannel` connections, and duplicate copies would open
duplicate connections per widget bundle for no benefit.

## Standalone Dev Harness

Each widget gets a `dev/` entry (`index.html` + `main.tsx`) that imports its
own UI component and mounts it directly, constructing real
`WidgetRuntimeProps` via `widget-runtime` with a fixed dev `instanceId` /
`typeId` — talking to the same running dev server (storage API, widget RPC)
the board would use. This `dev/` entry is also the widget's federation remote
dev server: `pnpm --filter widgets-clock dev` starts it, and opening its port
directly in a browser shows the widget alone with full functionality; the
board's host dev server consumes the same running process as its remote.

## Dev Workflow

`pnpm dev` stays the single command a developer runs, but its script changes
from `pnpm --filter client dev` to `pnpm -r --parallel --filter "./widgets/*"
--filter client dev`, starting the board and every widget's dev server
together. The `--filter "./widgets/*"` path glob is the same mechanism the
codegen step (see "Widget Registries and Codegen") relies on: it matches
whatever widget packages currently exist, so adding a widget folder makes
`pnpm dev` pick it up automatically — the script itself never lists widgets
by name and never needs editing.

Each widget reads its own dev port from `widgets/.ports.json` (see "Dev port
assignment" below) in its `vite.config.ts`; the host reads the same file to
populate its federation `remotes` config. Because that file persists
assignments across runs instead of deriving them from list position, a
widget's port never changes when other widgets are added or removed.
`dev: { remoteHmr: true }` keeps cross-bundle edits hot-reloading instead of
forcing a full page reload — this must be set on every widget's federation
config as well as the host's; setting it on the host alone is not enough
(confirmed by spike, see above).

## Production Build & Deploy

`pnpm build` also stays the single command, but its script changes from
`pnpm --filter client build` to `pnpm --filter "./widgets/*" build && pnpm
--filter client build`: every widget package builds first (in whatever order
pnpm resolves the glob; widgets do not depend on each other), each producing
its own `widgets/<id>/dist/` (`remoteEntry.js` plus chunks, with
`react`/`react-dom`/`@reatom/*`/`widget-runtime` external), then the client
build resolves federation remotes from those already-built `dist/`
directories. Like the dev script, this never names a widget explicitly, so a
new widget package is included automatically and `pnpm build` does not
change when widgets are added.

Deployment topology does not change: one Docker image, one nginx, the same
`pi.toml` target. Built widget `dist/` directories are copied into the
client's served output and exposed under `/widgets/<id>/`. No new service, no
CORS, no separate release cycle per widget. The existing 30-minute `pi.toml`
build timeout should be re-checked once the multi-step build (N widget builds
+ client build) is in place, since Pi hardware is already the slow case today.

## Widget Registries and Codegen

A build-time script globs `widgets/*/`, where each directory is expected to
contain `client.ts`, `server.ts`, and `package.json`, and generates:

- the client widget registry (replaces the hand-written import list in
  `client/src/widget-registry/model/registry.ts`);
- the server widget registry (replaces the hand-written import list in
  `server/src/widgets/production-registry.ts`);
- a manifest consumed by the host's federation config for production remote
  paths (dev ports come from `widgets/.ports.json`, see below — the one
  piece of this generated state that is committed, not gitignored).

These three are gitignored and regenerated as a pre-step before `dev`,
`build`, and `dev:server`, so they cannot drift from the actual contents of
`widgets/`. Adding a widget means adding its package folder (with its own
`package.json`, `vite.config.ts`, `client.ts`, and `server.ts`); no existing
registry file needs hand-editing to make it appear on both client and server.

### Dev port assignment

Dev ports cannot follow the same from-scratch regeneration rule: deriving a
widget's port from its position in an alphabetically (or filesystem-order)
sorted list means adding a widget that sorts earlier shifts every later
widget's port on the next regeneration — breaking saved browser tabs,
Docker port mappings, and any cached `remoteEntry.js` reference. Ports need
memory across runs, not just across the current `widgets/` contents.

Port assignment therefore lives in one additional file, `widgets/.ports.json`,
which is the one piece of generated state that is **committed**, not
gitignored:

```json
{ "clock": 5180, "ofelia-poop-duty": 5181 }
```

The codegen script reads this file, keeps every existing entry unchanged,
and appends the next free port (`max(existing ports) + 1`, starting at 5180
if the file does not exist yet) for any widget folder it does not already
list. Each `pnpm dev` or `pnpm build` run regenerates this file in place
alongside the gitignored registries above; adding a widget is still just
"add the folder, run `pnpm dev` once" — the only difference is that this one
file's diff (a single new line) gets committed with the new widget, the same
way a `pnpm install` diff to a lockfile gets committed. Removing a widget
leaves its entry unused rather than renumbering everything else; pruning a
stale entry is an optional manual cleanup, not something the codegen does
automatically.

The client widget catalog (used by the "add widget" panel for titles/icons)
becomes asynchronous, since `client.ts` now loads through `loadRemote()`
instead of a static import evaluated at board startup. The panel shows a
loading state until remote metadata resolves; a widget already placed on a
board continues to lazy-load through `WidgetFrame` exactly as it does today,
unaffected by catalog loading state.

## Error Handling

Unchanged in shape: `WidgetErrorBoundary` plus the existing lazy-load retry
path in `widget-frame-model.ts` already handle a failed widget chunk load and
already render the "Виджет не отвечает" card with retry. A failed federation
remote load (network error, widget dev server down, missing production
asset) surfaces through the same path. Shared-singleton version mismatches
are a build/dev-time failure of the federation plugin, not something the
runtime needs to recover from; the spike and CI are where this gets caught.
A single remote's metadata failing to load degrades only that entry in the
"add widget" panel, not the whole panel.

## Testing

Each widget package gets its own `vitest.config.ts` and `test` script,
matching the existing `client`/`server` pattern; `pnpm -r test` already picks
up every workspace package, so no root test-runner change is needed. The
special-cased `../widgets/**` test glob in `client/vite.config.ts` is removed
once widget tests run from their own packages. A lightweight smoke test
(e2e or otherwise) opens a widget's standalone `dev/` page and asserts it
renders, covering the harness itself.

## Phased Rollout

1. ~~Spike `@module-federation/vite` against this project's Rolldown-based
   Vite 8 build~~ — done 2026-06-30, see "Confirmed by spike" above. Go.
2. Extract `widget-runtime` from `client/src/storage` and
   `client/src/widget-api`. Pure refactor, no behavior change.
3. Convert `widgets/*` into individual pnpm packages with federation
   `exposes` and a standalone `dev/` harness, starting with `clock`, then
   `ofelia-poop-duty`. Wire the host to consume them as remotes.
4. Add the codegen script; remove the hand-written registries it replaces.
5. Update the production build pipeline, Dockerfile, and nginx config to
   build and serve widgets independently; re-verify the Pi build timeout.
6. Correct the stale widget-structure references in `AGENTS.md` /
   `CLAUDE.md` (they still describe the pre-move `client/widgets/<name>`
   path and the removed iframe-based standalone entries).

## Out of Scope

- Reintroducing a runtime sandbox (iframe, `postMessage`) or any trust
  boundary between board and widgets — widgets remain first-party.
- Independent per-widget deployment, hosting, or release cycles.
- Runtime hot-swapping of a widget's version independent of a board release.
- Any change to Clock or Ofelia business logic or behavior.
- Authentication, authorization, or permissions changes.
- Splitting the server build per widget.

## Success Criteria

- Each widget builds with its own `vite build` invocation and produces an
  independent artifact, verified by building one widget without invoking the
  client build.
- `react`, `react-dom`, `@reatom/core`, and `@reatom/react` are loaded once
  per page across board and all mounted widgets (no duplicate hook dispatcher
  errors).
- Editing a widget's source file updates the board view via HMR without a
  full page reload, matching today's dev experience.
- Each widget's standalone `dev/` entry renders correctly when opened
  directly, using real storage and widget RPC against a running dev server.
- Adding a new widget package under `widgets/` makes it appear in the client
  catalog and server dispatcher without hand-editing any registry file.
- Adding or removing a widget package never changes another existing
  widget's dev port (verified via `widgets/.ports.json`).
- `pnpm dev` is the only command needed to start the board and every
  widget's dev server together; adding a widget package requires no change
  to this command or its underlying script.
- `pnpm build` is the only command needed to build every widget and the
  client for production, in the right order; adding a widget package
  requires no change to this command or its underlying script.
- `pnpm build`, `pnpm test`, `pnpm typecheck`, and the Docker production
  build all pass with widgets built and deployed from the same nginx image.
