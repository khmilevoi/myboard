# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

See [AGENTS.md](./AGENTS.md) for the canonical repository guidelines (project structure, coding style, required skills, commit/PR conventions). This file adds command references and architecture notes that complement it — read both.

## Required skills

Before editing this repo, load the `reatom` and `errore` skills (referenced in AGENTS.md):

- **Reatom**: used for all atoms, actions, async flows, and React integration in `client/`.
- **errore**: used for TypeScript errors-as-values (tagged errors, `instanceof` narrowing, no throwing) across both `client/` and `server/`.

## Commands

Run from the repo root with pnpm unless noted.

```bash
pnpm dev                      # client Vite dev server
pnpm dev:server                # server in watch mode
pnpm build                     # typecheck + build client
pnpm --filter server build     # bundle server with Rspack
pnpm test                      # all workspace Vitest tests
pnpm --filter client test      # client tests only
pnpm --filter server test      # server tests only
pnpm test:e2e                  # Playwright e2e (client)
pnpm typecheck                 # workspace-wide tsc --noEmit
pnpm lint / pnpm lint:fix       # oxlint
pnpm format / pnpm format:check # oxfmt
pnpm docker:dev                 # Valkey + server + client with hot reload
pnpm docker:up                  # production-style Docker stack
```

Run a single test file or test name with Vitest directly, e.g.:

```bash
pnpm --filter client exec vitest run src/widget-registry/model/registry.test.ts
pnpm --filter client exec vitest run -t "test name substring"
```

Playwright specs (`client/e2e`) can be filtered the same way:

```bash
pnpm --filter client exec playwright test e2e/<file>.spec.ts
```

## Architecture

**Workspace layout**: pnpm workspace with `client` (Vite/React SPA) and `server` (Node storage API), plus a root-level `shared` package (`shared/json.ts`) imported via the `@shared/*` path alias from both. `@/*` aliases to `client/src`.

### Widget system

Widgets are the core extensibility unit. There are two layers:

- **`client/src/widget-registry`**: the static catalog (`registry.ts`) — each `WidgetType` declares an id, title, default grid size, an icon, optional tier config, and a lazy `loadComponent` loader pointing at a standalone widget module.
- **`client/widgets/<widget-name>`**: the actual widget implementations (e.g. `clock`, `ofelia-poop-duty`), each split into `model/` and `ui/` like other features. New widgets are added by creating a folder here and registering a `WidgetType` entry in the registry.
- **`client/src/widget-host`**: hosts a widget instance on the board — `WidgetFrame` (rendering, error boundary via `react-error-boundary`, fullscreen overlay) and `tier.ts` (resolves widget tier/size thresholds).

### Storage system (offline-first + sync)

`client/src/storage/model` implements per-widget storage with two scopes and two backends:

- **Scopes**: `instance` (namespaced to one widget placement, `w:i:<instanceId>:`) and `shared` (namespaced to a widget type, `w:t:<typeId>:`), created together by `createWidgetStorage()`.
- **Backends**: `client/dexie-storage.ts` (local IndexedDB via Dexie, the offline source of truth) and `server/http-storage.ts` (talks to the storage API server). `server/sse-client.ts` subscribes to server-sent events for live updates across clients; `client/channel.ts` is the cross-tab `BroadcastChannel` glue.
- `reatom/reatom-storage.ts` wires a storage scope into Reatom atoms for reactive read/write in widget models.
- Widgets choose which scope/backend combination to use depending on whether data is per-placement or shared across all instances of a widget type.

### Server (storage API)

`server/src/index.ts` is a plain `node:http` server routed with `find-my-way`, backed by Valkey (Redis-compatible):

- REST-ish endpoints under `/api/storage` (`GET`/`PUT`/`DELETE` by key, prefix listing, atomic `append` via `runExclusive` per-key locking in `storage/key-lock.ts`).
- `GET /api/storage/events` opens an SSE stream; clients `POST /api/storage/events/:connId` to subscribe/unsubscribe to key prefixes. Server-side fanout (`realtime/sse.ts`) is driven by a Valkey pub/sub subscriber on the `storage:events` channel, so writes from any server instance reach all connected SSE clients.
- All request/response bodies are validated with Zod schemas (`storage/schemas.ts`); validation failures return 422 with a formatted Zod error.
- Errors and control flow follow the errore pattern (tagged errors / `Error | T` unions) rather than throwing.

### Reatom + component convention

Every exported React function component in `client/src` and `client/widgets` must be wrapped with `reatomMemo` (`client/src/shared/reatom/reatom-memo.ts`) — this is enforced as a hard rule, including for trivial presentational components, so all components share the same Reatom/memo integration. Business logic, derived state, timers, and async flows belong in `model/`; `ui/` keeps only refs, DOM interop, and minimal view glue. Class-based error boundaries are kept internal to a module and exported as a `reatomMemo`-wrapped component (see `widget-host/ui/WidgetErrorBoundary.tsx`).

## Deployment

`pi.toml` configures deployment to a Raspberry Pi target via `docker-compose.yml`, with the `client` service as the ingress (port 80) and a generous 30-minute build timeout (SPA build + server image build is slow on Pi hardware).
