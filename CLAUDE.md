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
pnpm dev                      # codegen, then board + every widget dev server in parallel
pnpm dev:server                # codegen, then server in watch mode
pnpm build                     # codegen, build every widget remote, then typecheck/build the client host and PWA
pnpm --filter server build     # bundle server with Rspack
pnpm test                      # all workspace Vitest tests
pnpm --filter client test      # client tests only
pnpm --filter server test      # server tests only
pnpm test:e2e                  # board Playwright e2e against the assembled production-style Vite output
pnpm --filter client test:e2e:nginx # with docker compose up --build -d running, smoke-test the actual nginx image
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

**Workspace layout**: pnpm workspace with the `client` Vite/React host, the `server` Node API, root-level `shared`, singleton `widget-runtime`, stateless `widget-sdk`, and independently built `widgets/*` packages. `@/*` aliases only to `client/src`; shared widget code is imported through the two workspace package names.

### Widget system

- **`client/src/widget-registry`**: synchronous codegen-generated catalog metadata and icon map. Only `loadComponent` crosses the Module Federation boundary when a placed widget mounts.
- **`widgets/<widget-name>`**: one pnpm package per widget, split into `model/` and `ui/`, exposing only `./ui` as a federation remote and providing a standalone `dev/` harness. Adding a widget package and running codegen updates the client catalog, server registry, and stable port map without editing a hand-written registry.
- **`client/src/widget-host`**: mounts first-party widget components in the board React tree and provides frame/error-boundary/fullscreen behavior.
- **`widget-runtime` / `widget-sdk`**: shared runtime contracts/connections and stateless React/UI helpers respectively. React, React DOM, Reatom, and `widget-runtime` are strict federation singletons.

### Storage system (offline-first + sync)

`widget-runtime/src/storage` owns per-widget instance/shared scopes, Dexie and HTTP backends, SSE/BroadcastChannel fanout, and Reatom bindings. Board and standalone harnesses construct the same `WidgetRuntimeProps`; widgets do not import storage through `client/src`.

### Server (storage API)

`server/src/index.ts` is a plain `node:http` server routed with `find-my-way`, backed by Valkey (Redis-compatible):

- REST-ish endpoints under `/api/storage` (`GET`/`PUT`/`DELETE` by key, prefix listing, atomic `append` via `runExclusive` per-key locking in `storage/key-lock.ts`).
- `GET /api/storage/events` opens an SSE stream; clients `POST /api/storage/events/:connId` to subscribe/unsubscribe to key prefixes. Server-side fanout (`realtime/sse.ts`) is driven by a Valkey pub/sub subscriber on the `storage:events` channel, so writes from any server instance reach all connected SSE clients.
- All request/response bodies are validated with Zod schemas (`storage/schemas.ts`); validation failures return 422 with a formatted Zod error.
- Errors and control flow follow the errore pattern (tagged errors / `Error | T` unions) rather than throwing.

### Reatom + component convention

Every exported React function component in `client/src` and `widgets/*` is wrapped with `reatomMemo` from `widget-sdk`. Business logic, derived state, timers, and async flows belong in `model/`; `ui/` keeps refs, DOM interop, and minimal view glue. Class error boundaries stay internal and expose a `reatomMemo` wrapper.

## Deployment

`pi.toml` configures deployment to a Raspberry Pi target via `docker-compose.yml`, with the `client` service as the ingress (port 80) and a generous 30-minute build timeout (SPA build + server image build is slow on Pi hardware). The client image builds every widget remote first, stages them under `/widgets/<id>/`, and precaches them in the same PWA release.
