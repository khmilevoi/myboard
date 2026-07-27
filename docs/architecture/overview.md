# Architecture overview

Companion to the component map in `CLAUDE.md`. It describes intent and the reasons behind the
layering; the code is the source of truth. If the prose form stops being enough,
`architecture:architecture-generate` can expand this directory into per-component Mermaid documents
anchored to the code.

## Widget system

- **`packages/client/src/widget-registry`** — synchronous codegen-generated catalog metadata and
  icon map. Only `loadComponent` crosses the Module Federation boundary, and only when a placed
  widget mounts.
- **`packages/widgets/<widget-name>`** — one pnpm package per widget, split into `model/` and `ui/`,
  exposing only `./ui` as a federation remote and providing a standalone `dev/` harness. Adding a
  widget package and running codegen updates the client catalog, the server registry and the stable
  port map without editing a hand-written registry.
- **`packages/client/src/widget-host`** — mounts first-party widget components in the board React
  tree and provides the frame, error boundary and fullscreen behavior.
- **`widget-runtime` / `widget-sdk`** — shared runtime contracts and connections, and stateless
  React/UI helpers respectively. React, React DOM, Reatom and `widget-runtime` are strict federation
  singletons.

Server-side widget behavior — authored records, crons, the bundling constraint — is documented in
`docs/agent/widget-server.md`.

## Storage system (offline-first + sync)

`packages/widget-runtime/src/storage` owns per-widget instance and shared scopes, the Dexie and HTTP
backends, SSE/BroadcastChannel fanout, and the Reatom bindings. The board and the standalone
harnesses construct the same `WidgetRuntimeProps`; widgets never import storage through
`packages/client/src`.

Key derivation is a persistence contract. The rules, and the incident that proves what breaking them
costs, live in the header comment of `packages/shared/storage/scope.ts`.

## Server (storage API)

`packages/server/src/index.ts` is a plain `node:http` server routed with `find-my-way`, backed by
Valkey (Redis-compatible):

- REST-ish endpoints under `/api/storage` (`GET` / `PUT` / `DELETE` by key, prefix listing, atomic
  `append` via `runExclusive` per-key locking in `storage/key-lock.ts`).
- `GET /api/storage/events` opens an SSE stream; clients `POST /api/storage/events/:connId` to
  subscribe and unsubscribe to key prefixes. Server-side fanout (`realtime/sse.ts`) is driven by a
  Valkey pub/sub subscriber on the `storage:events` channel, so writes from any server instance
  reach every connected SSE client.
- All request and response bodies are validated with Zod schemas (`storage/schemas.ts`); validation
  failures return 422 with a formatted Zod error.
- Errors and control flow follow the errore pattern (tagged errors, `Error | T` unions) rather than
  throwing.
