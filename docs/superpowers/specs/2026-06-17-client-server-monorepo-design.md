# Client/Server Monorepo Restructure — Design

**Date:** 2026-06-17
**Status:** Approved

## Goal

Convert the flat, single-package project into a pnpm-workspace monorepo with two
packages — `client` (React/Vite SPA) and `server` (storage API) — each with its
own `node_modules`. Docker compose files stay at the repository root.

## Current State

The repo is a single flat pnpm package at the root:

- Root `package.json` mixes client deps (react, vite, reatom, dexie) and server
  deps (find-my-way, iovalkey, zod) in one manifest.
- `src/` — React/Vite SPA. `widgets/` — widget HTML entries. `index.html` — SPA entry.
- `server/` — storage API (tsx, find-my-way, iovalkey) with its own `Dockerfile`.
- `web/` — nginx `Dockerfile` + `nginx.conf` that serves the built SPA and
  reverse-proxies `/api` → server.
- Root config: `vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`,
  `tsconfig.e2e.json`, `playwright.config.ts`, `pnpm-workspace.yaml` (currently
  only `onlyBuiltDependencies: esbuild`).
- `docker-compose.yml` (prod: valkey, server, web), `docker-compose.dev.yml`
  (dev: valkey, server, client with bind mounts + named node_modules volumes).
- `pi.toml` — deployment to a Raspberry Pi via the `pi` CLI.

**Coupling check:** client and server share no code. `src/storage/server/http-storage.ts`
is a client-side HTTP adapter (folder named "server"), not an import of server
code. `zod` is used in both `src/env.ts` and `server/schemas.ts`. `errore` is
client-only. Therefore **no third `shared` package is needed** (YAGNI).

## Decisions

- **Workspace model:** pnpm workspace — one root `pnpm-lock.yaml`, one
  `pnpm install`, per-package `node_modules` created automatically by pnpm.
- **Docker location:** both compose files stay at root; each `Dockerfile` lives
  inside its package (`client/Dockerfile`, `server/Dockerfile`).
- **Service naming:** the prod compose service `web` is renamed to `client` for
  consistency with the dev compose (which already uses `client`); `pi.toml`
  ingress is updated accordingly.
- **No `shared` package** — client and server are decoupled.

## Target Structure

```
myboard/
├── package.json              # workspace root: scripts + packageManager only (no deps)
├── pnpm-workspace.yaml       # packages: [client, server]  (+ onlyBuiltDependencies: esbuild)
├── pnpm-lock.yaml            # single shared lockfile
├── docker-compose.yml        # prod (stays at root)
├── docker-compose.dev.yml    # dev  (stays at root)
├── .dockerignore             # NEW — context is now the whole root
├── pi.toml
├── .gitignore
├── docs/
│
├── client/                   # React/Vite SPA  → client/node_modules
│   ├── package.json
│   ├── Dockerfile            # ← from web/Dockerfile (nginx)
│   ├── nginx.conf            # ← from web/nginx.conf
│   ├── index.html            # ← from root
│   ├── vite.config.ts        # ← from root
│   ├── playwright.config.ts  # ← from root
│   ├── tsconfig.json         # app (DOM; includes src, widgets, tests)
│   ├── tsconfig.node.json    # for vite.config.ts
│   ├── tsconfig.e2e.json     # ← from root
│   ├── .env.example          # ← from root (only a VITE_ var)
│   ├── src/                  # ← from root
│   ├── widgets/              # ← from root
│   ├── tests/                # ← from root (test ../src)
│   └── e2e/                  # ← from root
│
└── server/                   # storage API  → server/node_modules
    ├── package.json
    ├── Dockerfile            # rewritten for workspace
    ├── tsconfig.json         # node (from tsconfig.node.json minus vite part)
    ├── index.ts  body.ts  handlers.ts  schemas.ts  valkey.ts
    └── *.test.ts
```

The `web/` directory is removed; its contents move into `client/`.

## Dependency & Script Split

### `client/package.json` (`"type": "module"`, `"private": true`)

- **dependencies:** react, react-dom, react-grid-layout, react-resizable,
  @reatom/core, @reatom/react, dexie, lucide-react,
  @fontsource-variable/fraunces, @fontsource-variable/nunito, errore, zod
- **devDependencies:** vite, @vitejs/plugin-react, vitest, jsdom,
  @testing-library/react, @testing-library/jest-dom, fake-indexeddb,
  @playwright/test, @types/react, @types/react-dom, @types/react-grid-layout,
  @types/node, typescript
- **scripts:** `dev` (vite), `build`
  (`tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json && vite build`),
  `preview`, `test` (vitest run), `test:watch`, `test:e2e` (playwright test),
  `typecheck`, `typecheck:e2e`

### `server/package.json` (`"type": "module"`, `"private": true`)

- **dependencies:** find-my-way, iovalkey, zod
- **devDependencies:** tsx, vitest, @types/node, typescript
- **scripts:** `dev` (`tsx watch index.ts`), `start` (`tsx index.ts`),
  `test` (vitest run), `typecheck`

### Root `package.json` (no deps; keeps `packageManager: pnpm@10.28.2`, `private: true`)

Delegating scripts:

- `dev` → `pnpm --filter client dev`
- `dev:server` → `pnpm --filter server dev`
- `build` → `pnpm --filter client build`
- `test` → `pnpm -r test`
- `typecheck` → `pnpm -r typecheck`
- `test:e2e` → `pnpm --filter client test:e2e`
- `docker:*` → unchanged (compose stays at root)

`zod` is intentionally declared in both packages; pnpm deduplicates in the store.

## TypeScript Config Split

- `client/tsconfig.json` — current root `tsconfig.json` (DOM libs; `include`
  becomes `["src", "widgets", "tests"]`).
- `client/tsconfig.node.json` — current root `tsconfig.node.json` reduced to
  `include: ["vite.config.ts"]` (the `server` entry is removed).
- `client/tsconfig.e2e.json` — moved unchanged (paths are relative).
- `server/tsconfig.json` — node config (target ES2022, `types: ["node"]`,
  `include: ["**/*.ts"]` or equivalent for the server sources/tests).

## Docker / Compose / Deploy

All builds use **context `.` (root)** because the shared `pnpm-lock.yaml` and
`pnpm-workspace.yaml` live at the root.

### `server/Dockerfile`

```dockerfile
FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY server/package.json ./server/
RUN pnpm install --frozen-lockfile --filter server...
COPY server ./server
WORKDIR /app/server
EXPOSE 8787
CMD ["pnpm", "exec", "tsx", "index.ts"]
```

### `client/Dockerfile` (was `web/Dockerfile`)

```dockerfile
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY client/package.json ./client/
RUN pnpm install --frozen-lockfile --filter client...
COPY client ./client
RUN pnpm --filter client build          # → client/dist

FROM nginx:alpine AS runtime
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
```

### `docker-compose.yml` (prod)

- `server` service: `build: { context: ., dockerfile: server/Dockerfile }`
  (environment/expose unchanged).
- `web` service renamed to `client`:
  `build: { context: ., dockerfile: client/Dockerfile }`,
  `depends_on: [server]`, `expose: ['80']`.
- `valkey` unchanged.

### `docker-compose.dev.yml` (dev)

- Bind mount stays `.:/app`; mask node_modules at all three levels with named
  volumes so the Windows host install does not clobber the Linux container install:
  ```yaml
  volumes:
    - .:/app
    - root_node_modules:/app/node_modules
    - client_node_modules:/app/client/node_modules
    - server_node_modules:/app/server/node_modules
  ```
- Service commands: `corepack enable && pnpm install && pnpm --filter <pkg> dev`.
- `CHOKIDAR_USEPOLLING=true` and ports/env retained.

### `pi.toml`

- `[build] compose` unchanged.
- `[ingress] service = "web"` → `"client"`.
- `[timeouts] build` unchanged.

### `.dockerignore` (new, at root)

Ignore `node_modules`, `**/node_modules`, `**/dist`, `test-results`,
`playwright-report`, `.git`, logs — the build context is now the entire root.

## Migration Order

Work on a feature branch. Use `git mv` to preserve history.

1. **Move files:** `git mv src widgets tests e2e index.html vite.config.ts
playwright.config.ts tsconfig.e2e.json .env.example client/`;
   `git mv web/Dockerfile client/Dockerfile`;
   `git mv web/nginx.conf client/nginx.conf`; remove the empty `web/`.
   Server files already live in `server/`.
2. **New manifests:** create `client/package.json`, `server/package.json`,
   `client/tsconfig.json`, `client/tsconfig.node.json`, `server/tsconfig.json`
   (split from the root tsconfigs).
3. **Root:** rewrite `package.json` (delegating scripts, no deps); add
   `packages: [client, server]` to `pnpm-workspace.yaml`; add `.dockerignore`.
4. **Docker/deploy:** rewrite both Dockerfiles, both compose files, `pi.toml`.
5. **Lockfile:** run `pnpm install` at root → regenerates `pnpm-lock.yaml` and
   creates `client/node_modules` and `server/node_modules`.

## Verification (evidence before claiming done)

- `pnpm install` succeeds; `client/node_modules` and `server/node_modules` exist.
- `pnpm -r typecheck` — both packages pass.
- `pnpm -r test` — vitest passes in both packages.
- `pnpm --filter client build` — vite build produces `client/dist`.
- `pnpm --filter client test:e2e` — playwright passes (optional, heavier).
- `docker compose -f docker-compose.dev.yml config` validates; optionally
  `docker compose -f docker-compose.dev.yml up --build` brings up the dev stack.
- Optionally `docker compose build` for prod images (slow off-Pi).

## Out of Scope

- No third `shared` package (client/server are decoupled).
- No change to application logic, routes, or storage behavior — this is a pure
  structural/build reorganization.
- No CI pipeline changes beyond what the script renames imply.
