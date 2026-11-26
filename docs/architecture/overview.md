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

## Modules

`packages/modules/<module-id>` holds widget-independent modules: one pnpm package per module, named
`module-<module-id>`, where the directory basename is the module ID. Codegen (`pnpm codegen
modules`) binds each `module.ts` to its ID in `generated/module.ts`, records module package versions
for the widget build, lists modules that have a `server.ts` for the server bundle (`@modules/*`),
and carries each module's scopes into the scoped owner list. A widget names the modules it uses in
its `client.ts`; codegen rejects a reference to a module that has no package, and reserves the
widget directory name `module`.

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

## Files

Bytes (avatars today; any file type a slot's policy accepts) never live in Valkey. A **file slot**
is a storage key under the `@files/<key>` sub-namespace whose value is a `FileRef`
(`packages/shared/files/contract.ts`): same branches, same ACL, same SSE as any other key. The
bytes are an immutable **blob** — a random, unguessable `blobId`, never overwritten; a new upload
is a new blob, and the slot swap deletes the old one. Each blob has a record `files:blob:<blobId>`
in Valkey naming its owning slot, its access rule (`members` or one `account`), its type and its
`Content-Disposition`. The persistence rules are in the header of `packages/shared/storage/scope.ts`.

- **Writes go through Node** (`packages/server/src/files/`): `PUT /api/files/scoped/...` and
  `PUT /api/files/account/avatar` read the raw body, enforce the slot's `FilePolicy` (deny by
  default; size → 413, sniffed type vs declared and `accept` → 415), store the blob, write its
  record, and swap the slot under the slot's lock. The browser resizes images before upload
  (`widget-sdk` `prepareImage`); the server has no native image code.
- **Bytes live in Garage** — a single-node, single-copy self-hosted S3 (`dxflrs/garage:v2.6.0`,
  `deploy/garage/garage.toml`) behind the `BlobStore` interface. On startup the server bootstraps
  it idempotently through the Admin API v2 (`garage-bootstrap.ts`): node role and layout, bucket
  `files` with website access, and an S3 key derived from the admin token by HMAC, so nothing is
  stored. It retries with backoff; file routes answer 503 until it succeeds. Without
  `FILES_S3_ENDPOINT` (host-run dev and e2e) a directory store at `FILES_FS_DIR` stands in.
- **Reads are a URL**, `/files/<blobId>`. In production nginx answers them: an `auth_request` to
  `GET /api/files/authorize` checks the session **and** the blob's access rule and hands back the
  recorded disposition, then nginx proxies the object from Garage's website endpoint. Node never
  streams a production read. Its own `GET /files/:blobId` fallback (dev, e2e) answers with the same
  headers: stored `Content-Type`, `nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`,
  and `Cache-Control: private, max-age=31536000, immutable` — never `public`, or Cloudflare would
  serve the file past the gate. The service worker caches `/files/` CacheFirst, since a blob URL
  never changes content.
- **Clients** reach slots through the runtime's `makeFileSlot` (`ref` atom over SSE, `upload`,
  `remove`), exposed as `files(scope, key)` on a module's context and `files(key)` on branch
  storage.
