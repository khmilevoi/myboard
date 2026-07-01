# Widget Build Isolation Design

**Date:** 2026-06-30
**Status:** Approved
**Revised:** 2026-07-01 — folded in fixes for gaps found in design review: the
full board surface widgets depend on (now split into `widget-runtime` +
`widget-sdk`), a synchronous codegen'd catalog, PWA precaching of remotes,
the standalone-harness dev proxy, production base paths / nginx verification,
federation version strictness, codegen lifecycle in CI, and e2e topology.

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
- Extract the board surface widgets depend on into two new packages:
  `widget-runtime` (storage, widget RPC, SSE/`BroadcastChannel`, server-time —
  the live-connection singletons) and `widget-sdk` (reatom/React glue,
  `defineWidgetClient`, tier, shared UI primitives), both shared by the board
  and by standalone widget dev/preview entrypoints.
- Add a standalone dev entrypoint per widget that mounts it directly against
  a real running server.
- Replace the hand-maintained widget lists (client registry, server registry,
  host remote config, and the `WidgetIconName` union) with a single
  build-time codegen step.
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
manage this: each widget is a federation **remote** exposing only its UI
component (its `loadComponent` target), not its whole `client.ts` — the
widget's static metadata is codegen'd into the board at build time (see
"Widget Registries and Codegen"), so the board never loads a remote just to
populate its catalog. The board is the federation **host** that consumes
widgets as remotes and declares `react`, `react-dom`, `@reatom/core`,
`@reatom/react`, and `widget-runtime` as shared **singletons** (with
`strictVersion`, so a version mismatch fails the build instead of silently
loading two copies — see "Error Handling"). `widget-sdk` is declared as a
shared dependency but does not need to be a singleton: it is stateless React
glue and presentational UI, not a live connection. In production, the plugin
resolves remotes from prebuilt assets served under `/widgets/<id>/`.

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
    package.json          # new: name "widgets-clock", own deps, own scripts
    vite.config.ts         # federation({ name: 'clock', exposes: { './ui': './ui/Clock' }, shared: [...] }), base: '/widgets/clock/'
    client.ts / server.ts / types.ts
    model/ ui/ server/
    dev/
      index.html
      main.tsx             # standalone harness, see below
  ofelia-poop-duty/
    ... same shape (package name "widgets-ofelia-poop-duty")
widget-runtime/             # new package: live connections, federation singleton
  package.json
  src/
    storage.ts              # makeWidgetStorage (Dexie + HTTP backend) + reatom binding
    widget-api.ts           # makeWidgetApi (HTTP RPC client)
    sse.ts / channel.ts     # SSE client + BroadcastChannel glue (live connections)
    server-time.ts          # getServerTime singleton (shared offset, sync, visibility listener)
    types.ts                # WidgetRuntimeProps, StorageApi, WidgetStorage, ...
widget-sdk/                 # new package: stateless React glue + UI, shared (not singleton)
  package.json
  src/
    reatom-memo.ts          # reatomMemo (mandatory component wrapper)
    use-atom-value.ts
    define-widget-client.ts # defineWidgetClient + widget metadata types
    tier.ts                 # widget tier types / thresholds
    vite-dev-config.ts      # shared dev Vite config factory (/api proxy, SSE, remoteHmr)
    ui/                     # WidgetControls, Tabs/TabsList/TabsTrigger, ...
```

`pnpm-workspace.yaml` changes `widgets` to the glob `widgets/*`, and adds
`widget-runtime` and `widget-sdk`.

## Widget Runtime and SDK Packages

Widgets today reach into the board through the `@/` alias (→ `client/src`) for
far more than storage and widget RPC. A non-test grep of `widgets/*` finds
imports of `@/shared/reatom/reatom-memo` (the mandatory `reatomMemo` wrapper,
used by every widget component), `@/shared/reatom/use-atom-value`,
`@/shared/timer/model/server-time`, `@/widget-host/ui/WidgetControls`,
`@/widget-host/model/tier`, `@/components/ui/tabs`,
`@/widget-registry/model/widget-definition` (`defineWidgetClient`, called by
every `client.ts`), and `@/storage/...`. Once a widget is a standalone
package, the `@/` alias no longer resolves, so all of these must move out of
the board into shared packages. Extracting only `storage` + `widget-api` (as
an earlier draft of this design assumed) is not enough.

The extracted surface is split across two packages by one rule: **does it
hold a live connection or shared mutable runtime state?**

`widget-runtime` (federation-shared **singleton**) — anything that must exist
once per page:

- `storage` (Dexie + HTTP backend) and its reatom binding,
- `widget-api` (HTTP RPC client),
- the SSE client and `BroadcastChannel` glue — live connections; duplicate
  copies would open duplicate connections per widget bundle for no benefit,
- `server-time` — `getServerTime()` is a module-level singleton holding a
  shared clock offset, a network sync, and a `visibilitychange` listener;
  duplicate copies would each sync and listen independently, so it belongs
  here rather than in `widget-sdk`,
- runtime contract types (`WidgetRuntimeProps`, `StorageApi`, `WidgetStorage`).

`widget-sdk` (federation-shared, but **not** required to be a singleton — it
is stateless React glue and presentational UI):

- `reatomMemo` and `useAtomValue` — the reatom/React integration; this is how
  widgets get the shared `@reatom/react` layer (resolving the apparent
  inconsistency of declaring `@reatom/react` a singleton while no widget
  imports it directly),
- `defineWidgetClient` and the widget metadata types,
- `tier` types and thresholds,
- the shared dev Vite config factory (see "Dev Workflow"),
- shared UI primitives `WidgetControls` and `Tabs`/`TabsList`/`TabsTrigger`,
  moved out of the board (`client/src/widget-host/ui`,
  `client/src/components/ui`) so widgets stop importing board chrome through
  `@/`.

The board and every widget (including its standalone dev entry) depend on
both packages and get the same implementation — no duplicated storage/transport
code, and no risk of the standalone harness drifting from what the board
injects.

## Standalone Dev Harness

Each widget gets a `dev/` entry (`index.html` + `main.tsx`) that imports its
own UI component and mounts it directly, constructing real
`WidgetRuntimeProps` via `widget-runtime` with a fixed dev `instanceId` /
`typeId` — talking to the same running dev server (storage API, widget RPC)
the board would use. This `dev/` entry is also the widget's federation remote
dev server: `pnpm --filter widgets-clock dev` starts it, and opening its port
directly in a browser shows the widget alone with full functionality; the
board's host dev server consumes the same running process as its remote.

Because the widget dev server is a separate Vite server on its own port, it
reaches the storage API and widget RPC through the same `/api` proxy the board
uses, supplied by the shared dev Vite config factory in `widget-sdk`
(`vite-dev-config.ts`: target `VITE_API_PROXY ?? http://localhost:8787`,
`changeOrigin`, SSE-compatible). All calls stay same-origin, so no CORS
handling is added to the server.

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
(confirmed by spike, see above). The board and every widget build their dev
server config from the shared factory in `widget-sdk` (`vite-dev-config.ts`),
so the `/api` proxy, SSE proxying, and `remoteHmr` setting are defined once
and cannot drift between board and widgets.

## Production Build & Deploy

`pnpm build` also stays the single command, but its script changes from
`pnpm --filter client build` to `pnpm --filter "./widgets/*" build && pnpm
--filter client build`: every widget package builds first (in whatever order
pnpm resolves the glob; widgets do not depend on each other), each producing
its own `widgets/<id>/dist/` (`remoteEntry.js` plus chunks, with
`react`/`react-dom`/`@reatom/*`/`widget-runtime`/`widget-sdk` external) built
with `base: '/widgets/<id>/'` so its emitted asset URLs resolve from the
subpath it is served under, then the client build resolves federation remotes
from those already-built `dist/` directories. Like the dev script, this never
names a widget explicitly, so a new widget package is included automatically
and `pnpm build` does not change when widgets are added.

Deployment topology does not change: one Docker image, one nginx, the same
`pi.toml` target. Built widget `dist/` directories are copied into the
client's served output and exposed under `/widgets/<id>/` — and the copy
happens **before the client's PWA service worker is generated**, so Workbox
includes `/widgets/**` in its precache manifest with per-file revision hashes.
That means widget remotes are precached (available offline) and update
atomically with each deploy, with no stale `CacheFirst` `remoteEntry.js`;
because deployment is single-image / single-release, treating widgets as part
of the app shell matches how they actually ship. No new service, no CORS, no
separate release cycle per widget.

Because the spike validated only `vite build` + `vite preview` (flat-served),
the production path — the board resolving `/widgets/<id>/remoteEntry.js` from
the actual nginx image, with each widget's `base` applied — must be verified
explicitly as part of this step (Phased Rollout step 5), not assumed from the
preview result. The existing 30-minute `pi.toml` build timeout should also be
re-checked once the multi-step build (N widget builds + client build) is in
place, since Pi hardware is already the slow case today.

## Widget Registries and Codegen

A single build-time `codegen` script globs `widgets/*/`, where each directory
is expected to contain `client.ts`, `server.ts`, and `package.json`, and
generates:

- the client widget registry (replaces the hand-written import list in
  `client/src/widget-registry/model/registry.ts`). It inlines each widget's
  **static metadata** (`id`, `title`, `description`, `defaultSize`, `icon`)
  read from `client.ts`, plus a `loadComponent` thunk that calls
  `loadRemote()`. Because the metadata is inlined at build time, the "add
  widget" catalog stays synchronous — only the UI component crosses the
  federation boundary at mount time, exactly as today's lazy `import()` does;
- the `WidgetIconName` union (today a hand-maintained
  `'Clock' | 'CalendarDays' | 'Cat'` in `widget-definition.ts`), derived from
  the same metadata so adding a widget with a new icon needs no hand-edit;
- the server widget registry (replaces the hand-written import list in
  `server/src/widgets/production-registry.ts`);
- a manifest consumed by the host's federation config for production remote
  paths (dev ports come from `widgets/.ports.json`, see below — the one
  piece of this generated state that is committed, not gitignored).

All generated files except `.ports.json` are gitignored. The `codegen` script
is wired as an explicit `pre*` step of **every** script that imports them —
not just `dev`, `build`, and `dev:server`, but also `typecheck` and `test`,
since `registry.test.ts` and `production-registry.ts` import the generated
registries and a fresh checkout or CI run that typechecks/tests before
building would otherwise fail on missing files. `lint`/`format` ignore the
`*.generated.*` files. This keeps the generated state from drifting from the
actual contents of `widgets/`. Adding a widget means adding its package folder
(with its own `package.json`, `vite.config.ts`, `client.ts`, and `server.ts`);
no existing registry file needs hand-editing to make it appear on both client
and server.

The client widget catalog (used by the "add widget" panel for titles/icons)
stays **synchronous**: its metadata is the codegen-inlined static data above,
not a `loadRemote()` result, so the panel renders the full widget list
immediately without fetching any remote. Only the UI component loads through
`loadRemote()`, and only when a widget is actually mounted — a widget placed
on a board lazy-loads through `WidgetFrame` exactly as it does today. (An
earlier draft made the whole catalog asynchronous; that forced loading every
widget's remote just to list titles, a needless regression that the static
codegen avoids.)

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

## Error Handling

Unchanged in shape: `WidgetErrorBoundary` plus the existing lazy-load retry
path in `widget-frame-model.ts` already handle a failed widget chunk load and
already render the "Виджет не отвечает" card with retry. A failed federation
remote load (network error, widget dev server down, missing production
asset) surfaces through the same path. A shared-singleton version mismatch is,
by default, only a runtime warning in Module Federation; to make it the
build/dev-time failure this design wants, the shared config declares `react`,
`react-dom`, `@reatom/core`, `@reatom/react`, and `widget-runtime` with
`singleton: true` **and** `strictVersion`/`requiredVersion`. Because these are
workspace packages pinned through the pnpm `catalog`, every consumer resolves
the same version anyway, so a mismatch can only come from a misconfigured
`package.json` — caught by the spike and CI builds, not something the runtime
needs to recover from. A widget that is mounted but whose remote fails to load
degrades only that widget (via the error boundary above); the catalog itself
no longer depends on remote loads, so it cannot be degraded by one.

## Testing

Each widget package gets its own `vitest.config.ts` and `test` script,
matching the existing `client`/`server` pattern; `pnpm -r test` already picks
up every workspace package, so no root test-runner change is needed. The
special-cased `../widgets/**` test glob in `client/vite.config.ts` is removed
once widget tests run from their own packages. A lightweight smoke test
(e2e or otherwise) opens a widget's standalone `dev/` page and asserts it
renders, covering the harness itself.

Existing board e2e (`client/e2e`) now depends on the widget remotes being
available, so it runs against the production-style build rather than a single
dev server: `codegen`, then build every widget and the client, then serve via
Vite preview with the widget `dist/` copied under `/widgets/<id>/`, so remotes
resolve through the same path they use in production. Each widget package is
named `widgets-<dir>` (e.g. `widgets-clock`) so name-based filters like
`pnpm --filter widgets-clock dev` work; the path-glob `--filter "./widgets/*"`
works regardless of the package name.

## Phased Rollout

1. ~~Spike `@module-federation/vite` against this project's Rolldown-based
   Vite 8 build~~ — done 2026-06-30, see "Confirmed by spike" above. Go.
2. Extract two packages from the board: `widget-runtime` (storage,
   widget-api, SSE/`BroadcastChannel`, `server-time`, runtime types) and
   `widget-sdk` (`reatomMemo`, `useAtomValue`, `defineWidgetClient`, `tier`,
   the shared dev Vite config, and the `WidgetControls`/`Tabs` UI primitives).
   Rewrite the `@/` imports in `widgets/*` to point at these packages. A
   refactor with no behavior change, but larger than two directories — it
   covers the full board surface widgets depend on.
3. Convert `widgets/*` into individual pnpm packages (each named
   `widgets-<dir>`) with federation `exposes` for the UI component only, a
   `base: '/widgets/<id>/'` build, and a standalone `dev/` harness built from
   the shared dev Vite config, starting with `clock`, then `ofelia-poop-duty`.
   Wire the host to consume them as remotes, with `remoteHmr` set on every
   config.
4. Add the single `codegen` script (client registry with inlined static
   metadata, `WidgetIconName` union, server registry, federation manifest);
   wire it as a `pre*` step of `dev`, `build`, `dev:server`, `typecheck`, and
   `test`; remove the hand-written registries and icon union it replaces.
5. Update the production build pipeline, Dockerfile, and nginx config to
   build and serve widgets independently; copy widget `dist/` into the client
   output before the PWA service worker is generated so `/widgets/**` is
   precached; reconcile the existing manual `codeSplitting.groups` (react/
   reatom vendors) with the federation `shared` config; verify the board loads
   `/widgets/<id>/remoteEntry.js` from the actual nginx image (not just
   `vite preview`); re-verify the Pi build timeout.
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
- The "add widget" catalog renders its full list synchronously from
  codegen-inlined metadata, fetching a widget's remote only when that widget
  is mounted.
- In production the board loads each widget's `remoteEntry.js` from the
  nginx-served `/widgets/<id>/` path, and the service worker precaches widget
  remotes so they work offline and update atomically on deploy.
- `pnpm typecheck` and `pnpm test` pass on a fresh checkout with no prior
  `dev`/`build`, because `codegen` runs as their `pre*` step.
- `pnpm build`, `pnpm test`, `pnpm typecheck`, and the Docker production
  build all pass with widgets built and deployed from the same nginx image.
