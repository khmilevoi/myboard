# Client/Server Monorepo Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the flat single-package repo into a pnpm-workspace monorepo with two packages — `client` (React/Vite SPA) and `server` (storage API) — each with its own `node_modules`, keeping Docker compose files at the root.

**Architecture:** A pnpm workspace with one root `pnpm-lock.yaml` and `pnpm-workspace.yaml` listing `client` and `server`. The root `package.json` carries no dependencies — only delegating scripts. Each package owns its build/test config and its own `Dockerfile`; compose files and `pi.toml` stay at the root and reference the per-package Dockerfiles with build context `.`.

**Tech Stack:** pnpm 10.28.2, Node 22 (alpine in Docker), Vite 8 + React 19 (client), tsx + find-my-way + iovalkey (server), Vitest (both), Playwright (client e2e), nginx (client prod image), Valkey (datastore).

## Global Constraints

- Package manager: `pnpm@10.28.2` (pinned in root `package.json` `packageManager`).
- Package names are **unscoped**: `client` and `server` (so `pnpm --filter client` / `--filter server` resolve by name).
- `zod` (`^4.4.3`) is declared in **both** packages (used by `client/src/env.ts` and `server/schemas.ts`).
- No third `shared` package — client and server share no code.
- Compose files stay at repo root; each `Dockerfile` lives inside its package; Docker build context is always `.` (the shared lockfile is at root).
- Prod compose service `web` is renamed to `client`; `pi.toml` ingress must match.
- Dependency version specifiers are copied **verbatim** from the current root `package.json` — do not bump versions.
- Node base image: `node:22-alpine`; client runtime image: `nginx:alpine`.

---

### Task 1: Convert to a pnpm workspace (client + server packages)

Move all client sources into `client/`, give `client` and `server` their own manifests and tsconfigs, strip the root `package.json` to a workspace root, regenerate the lockfile, and prove the existing test suite still passes. This is a refactor under the existing (green) test suite — the tests are the safety net.

**Files:**

- Create: `client/package.json`, `server/package.json`, `server/tsconfig.json`
- Move (via `git mv`): `src`, `widgets`, `tests`, `e2e`, `index.html`, `vite.config.ts`, `playwright.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `tsconfig.e2e.json`, `.env.example` → `client/`; `web/Dockerfile` → `client/Dockerfile`; `web/nginx.conf` → `client/nginx.conf`
- Modify: `client/tsconfig.node.json` (drop `server` from `include`), `package.json` (root), `pnpm-workspace.yaml`
- Remove: empty `web/` directory

**Interfaces:**

- Produces (consumed by Task 2): package names `client` and `server`; regenerated `pnpm-lock.yaml`; client production build output at `client/dist`; nginx config at `client/nginx.conf`; per-package manifests `client/package.json` and `server/package.json`.

- [ ] **Step 1: Create the feature branch**

```bash
git checkout -b restructure/client-server-monorepo
```

Expected: `Switched to a new branch 'restructure/client-server-monorepo'`.

- [ ] **Step 2: Move client sources into `client/`**

```bash
mkdir -p client
git mv src widgets tests e2e index.html vite.config.ts playwright.config.ts tsconfig.json tsconfig.node.json tsconfig.e2e.json .env.example client/
```

Expected: `git status` shows the above as renames into `client/`. No edits needed to `vite.config.ts` (its `__dirname`-relative `widgets`/`index.html` paths travel with the file), `tsconfig.json`, `tsconfig.e2e.json`, or `playwright.config.ts` (all paths are relative).

- [ ] **Step 3: Move the nginx image into `client/` and drop `web/`**

```bash
git mv web/Dockerfile client/Dockerfile
git mv web/nginx.conf client/nginx.conf
rmdir web
```

Expected: `web/` no longer exists; `client/Dockerfile` and `client/nginx.conf` present. (The Dockerfile is rewritten in Task 2; moving it here records the rename.)

- [ ] **Step 4: Create `client/package.json`**

```json
{
  "name": "client",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit --incremental false -p tsconfig.json && tsc --noEmit --incremental false -p tsconfig.node.json && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "test:e2e:ui": "playwright test --ui",
    "typecheck": "tsc --noEmit --incremental false -p tsconfig.json && tsc --noEmit --incremental false -p tsconfig.node.json",
    "typecheck:e2e": "tsc -p tsconfig.e2e.json --noEmit"
  },
  "dependencies": {
    "@fontsource-variable/fraunces": "^5.2.9",
    "@fontsource-variable/nunito": "^5.2.7",
    "@reatom/core": "^1001.1.0",
    "@reatom/react": "^1001.0.0",
    "dexie": "^4.4.4",
    "errore": "^0.14.1",
    "lucide-react": "1.19.0",
    "react": "^19.2.7",
    "react-dom": "^19.2.7",
    "react-grid-layout": "^2.2.3",
    "react-resizable": "^4.0.1",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@playwright/test": "^1.61.0",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@types/node": "^25.9.3",
    "@types/react": "^19.2.17",
    "@types/react-dom": "^19.2.3",
    "@types/react-grid-layout": "^2.1.0",
    "@vitejs/plugin-react": "^6.0.2",
    "fake-indexeddb": "^6.2.5",
    "jsdom": "^29.1.1",
    "typescript": "^6.0.3",
    "vite": "^8.0.16",
    "vitest": "^4.1.9"
  }
}
```

- [ ] **Step 5: Create `server/package.json`**

```json
{
  "name": "server",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch index.ts",
    "start": "tsx index.ts",
    "test": "vitest run",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "find-my-way": "^9.6.0",
    "iovalkey": "^0.3.3",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^25.9.3",
    "tsx": "^4.22.4",
    "typescript": "^6.0.3",
    "vitest": "^4.1.9"
  }
}
```

Note: `server` needs no Vitest config — its tests (`body.test.ts`, `handlers.test.ts`) are pure Node, import `vitest` helpers explicitly, and use no jsdom/setup. Vitest's default `node` environment covers them.

- [ ] **Step 6: Create `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["**/*.ts"]
}
```

- [ ] **Step 7: Trim `client/tsconfig.node.json` to the Vite config only**

The moved file currently reads `"include": ["vite.config.ts", "server"]`. Edit it to:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["vite.config.ts"]
}
```

(Only the `include` array changes — `"server"` is removed; the server now has its own tsconfig.)

- [ ] **Step 8: Rewrite the root `package.json` as a workspace root**

```json
{
  "name": "myboard",
  "private": true,
  "version": "0.0.0",
  "packageManager": "pnpm@10.28.2",
  "scripts": {
    "dev": "pnpm --filter client dev",
    "dev:server": "pnpm --filter server dev",
    "build": "pnpm --filter client build",
    "preview": "pnpm --filter client preview",
    "test": "pnpm -r test",
    "test:e2e": "pnpm --filter client test:e2e",
    "typecheck": "pnpm -r typecheck",
    "docker:up": "docker compose up --build -d",
    "docker:down": "docker compose down",
    "docker:server": "docker compose up --build -d valkey server",
    "docker:logs": "docker compose logs -f",
    "docker:dev": "docker compose -f docker-compose.dev.yml up --build",
    "docker:dev:down": "docker compose -f docker-compose.dev.yml down",
    "docker:dev:logs": "docker compose -f docker-compose.dev.yml logs -f"
  }
}
```

(All `dependencies`/`devDependencies` and `"type": "module"` are removed — the root holds no source.)

- [ ] **Step 9: List the workspace packages in `pnpm-workspace.yaml`**

```yaml
packages:
  - client
  - server
onlyBuiltDependencies:
  - esbuild
```

- [ ] **Step 10: Clean stale install artifacts and regenerate the lockfile**

```bash
rm -rf node_modules dist test-results client/node_modules server/node_modules
pnpm install
```

Expected: install completes without `ERR_PNPM_*`; `pnpm-lock.yaml` is updated; `client/node_modules` and `server/node_modules` are created. (If install reports the lockfile is out of date, that is expected on the first run — it regenerates it.)

- [ ] **Step 11: Confirm each package has its own `node_modules`**

```bash
ls -d client/node_modules server/node_modules
```

Expected: both paths listed (no error).

- [ ] **Step 12: Typecheck both packages**

```bash
pnpm -r typecheck
```

Expected: runs `typecheck` in `client` and `server`; both finish with no TypeScript errors.

- [ ] **Step 13: Run unit tests in both packages**

```bash
pnpm -r test
```

Expected: `client` Vitest suite passes (jsdom, via `client/vite.config.ts` test block) and `server` Vitest suite passes (node). No failures.

- [ ] **Step 14: Build the client bundle**

```bash
pnpm --filter client build
```

Expected: tsc passes, Vite build succeeds, output written to `client/dist` (contains `index.html` plus the per-widget entries).

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "refactor: split into client and server pnpm workspace packages

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Rewrite Docker images, compose, and deploy config for the workspace

Point both Dockerfiles at the workspace layout (context `.`, copy the root manifests + both package manifests, filtered install), rename the prod `web` service to `client`, fix the dev compose for per-package `node_modules` volumes with a single shared install, add a root `.dockerignore`, and update `pi.toml` ingress.

**Files:**

- Modify: `server/Dockerfile`, `client/Dockerfile`, `docker-compose.yml`, `docker-compose.dev.yml`, `pi.toml`
- Create: `.dockerignore` (root)

**Interfaces:**

- Consumes (from Task 1): package names `client`/`server`, regenerated `pnpm-lock.yaml`, `client/dist` build output, `client/nginx.conf`, both package manifests.

- [ ] **Step 1: Rewrite `server/Dockerfile`**

```dockerfile
FROM node:22-alpine
WORKDIR /app
RUN corepack enable
# Copy workspace manifests first for layer caching. Both package manifests are
# required so pnpm can validate the workspace against the frozen lockfile, even
# though only `server` is installed.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
RUN pnpm install --frozen-lockfile --filter server...
COPY server ./server
WORKDIR /app/server
EXPOSE 8787
CMD ["pnpm", "exec", "tsx", "index.ts"]
```

- [ ] **Step 2: Rewrite `client/Dockerfile`**

```dockerfile
# syntax=docker/dockerfile:1

# --- build stage: bundle the SPA with Vite ---
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/
RUN pnpm install --frozen-lockfile --filter client...
COPY client ./client
# Type-checking runs in CI (`pnpm -r typecheck`); the deploy image only needs
# the bundle, so run Vite directly to keep Raspberry Pi builds fast.
RUN pnpm --filter client exec vite build

# --- runtime stage: serve static files + reverse-proxy /api -> server ---
FROM nginx:alpine AS runtime
COPY client/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/client/dist /usr/share/nginx/html
EXPOSE 80
```

- [ ] **Step 3: Create the root `.dockerignore`**

```
node_modules
**/node_modules
dist
**/dist
test-results
playwright-report
.git
*.log
.env
.env.local
.env.*.local
```

- [ ] **Step 4: Rewrite `docker-compose.yml` (prod) — rename `web` → `client`**

```yaml
services:
  valkey:
    image: valkey/valkey:8-alpine
    ports:
      - '127.0.0.1:6379:6379'

  server:
    build:
      context: .
      dockerfile: server/Dockerfile
    environment:
      VALKEY_URL: redis://valkey:6379
      PORT: '8787'
    depends_on:
      - valkey
    expose:
      - '8787'

  client:
    build:
      context: .
      dockerfile: client/Dockerfile
    depends_on:
      - server
    expose:
      - '80'
```

- [ ] **Step 5: Rewrite `docker-compose.dev.yml` (dev)**

A single one-shot `install` service populates the shared workspace `node_modules` volumes once; `server` and `client` wait for it to finish, then run their dev commands. This avoids two concurrent `pnpm install` runs corrupting the shared root `.pnpm` store.

```yaml
# Development stack with hot reload. Run with:
#   pnpm docker:dev        -> docker compose -f docker-compose.dev.yml up --build
#   pnpm docker:dev:down   -> tear it down
#
# - client: Vite dev server with HMR at http://localhost:5173
# - server: storage-api auto-restarted on change via `tsx watch`
# - source is bind-mounted; file watching uses polling (CHOKIDAR_USEPOLLING)
#   so edits on a Windows/macOS host are detected through the Docker bind mount.
# - node_modules for the root and both packages live in named volumes so the
#   host's (Windows) install is not clobbered by the container's (Linux) install.
# - `install` runs `pnpm install` once; server/client start only after it
#   completes successfully, so the shared root .pnpm store is written by one
#   process.
services:
  valkey:
    image: valkey/valkey:8-alpine
    ports:
      - '127.0.0.1:6379:6379'

  install:
    image: node:22-alpine
    working_dir: /app
    command: sh -c "corepack enable && pnpm install"
    volumes:
      - .:/app
      - root_node_modules:/app/node_modules
      - client_node_modules:/app/client/node_modules
      - server_node_modules:/app/server/node_modules

  server:
    image: node:22-alpine
    working_dir: /app
    command: sh -c "corepack enable && pnpm --filter server dev"
    environment:
      VALKEY_URL: redis://valkey:6379
      PORT: '8787'
      CHOKIDAR_USEPOLLING: 'true'
    volumes:
      - .:/app
      - root_node_modules:/app/node_modules
      - client_node_modules:/app/client/node_modules
      - server_node_modules:/app/server/node_modules
    ports:
      - '127.0.0.1:8787:8787'
    depends_on:
      install:
        condition: service_completed_successfully
      valkey:
        condition: service_started

  client:
    image: node:22-alpine
    working_dir: /app
    command: sh -c "corepack enable && pnpm --filter client dev --host"
    environment:
      VITE_API_PROXY: http://server:8787
      CHOKIDAR_USEPOLLING: 'true'
    volumes:
      - .:/app
      - root_node_modules:/app/node_modules
      - client_node_modules:/app/client/node_modules
      - server_node_modules:/app/server/node_modules
    ports:
      - '5173:5173'
    depends_on:
      install:
        condition: service_completed_successfully
      server:
        condition: service_started

volumes:
  root_node_modules:
  client_node_modules:
  server_node_modules:
```

- [ ] **Step 6: Update `pi.toml` ingress service**

Change the `[ingress]` block's `service` value from `web` to `client`. The full file should read:

```toml
schema = 1

[project]
name = "myboard"

[source]
repo = "git@github.com:khmilevoi/myboard.git"
branch = "master"

[build]
compose = "docker-compose.yml"

[ingress]
service = "client"
port = 80

[healthcheck]
path = "/"
expect = "200"
timeout = "60s"

# Building the SPA (pnpm install + vite build) plus the server image on a
# Raspberry Pi is slow; give the build stage generous headroom.
[timeouts]
build = "30m"
```

- [ ] **Step 7: Validate both compose files**

```bash
docker compose config >/dev/null && echo PROD_OK
docker compose -f docker-compose.dev.yml config >/dev/null && echo DEV_OK
docker compose config --services
```

Expected: prints `PROD_OK` and `DEV_OK`; the services list contains `client` (and `server`, `valkey`) and **no** `web`.

- [ ] **Step 8: Build the production images**

```bash
docker compose build
```

Expected: both `server` and `client` images build successfully. This takes several minutes (the `client` image runs `pnpm install` + `vite build`). The filtered installs must succeed against the frozen lockfile regenerated in Task 1.

- [ ] **Step 9 (optional): Smoke-test the dev stack**

```bash
docker compose -f docker-compose.dev.yml up -d --build
# give the install service + dev servers time to come up, then:
curl -fsS http://localhost:5173 >/dev/null && echo CLIENT_DEV_OK
docker compose -f docker-compose.dev.yml down
```

Expected: `CLIENT_DEV_OK` (the Vite dev server responds). Heavier/optional — skip if Docker is unavailable in the execution environment.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "build: move Dockerfiles into packages and wire compose for the workspace

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage** (each spec section maps to a task):

- Target structure / file moves → Task 1, Steps 2–3.
- Workspace model (`pnpm-workspace.yaml`, per-package `node_modules`) → Task 1, Steps 9–11.
- Dependency & script split (client/server/root manifests) → Task 1, Steps 4–5, 8.
- TypeScript config split → Task 1, Steps 6–7 (client `tsconfig.json`/`tsconfig.e2e.json` move unchanged in Step 2).
- Docker images (context `.`, filtered install) → Task 2, Steps 1–2.
- `.dockerignore` → Task 2, Step 3.
- Compose prod (`web`→`client`) → Task 2, Step 4.
- Compose dev (node_modules volumes) → Task 2, Step 5.
- `pi.toml` ingress → Task 2, Step 6.
- Verification (install/typecheck/test/build, compose config/build) → Task 1 Steps 11–14, Task 2 Steps 7–9.

**Placeholder scan:** No TBD/TODO; every file step contains full content; every command has an expected result.

**Type/name consistency:** Package names `client`/`server` used consistently across manifests, root scripts (`--filter client`/`--filter server`), Dockerfiles (`--filter client...`/`--filter server...`), and compose service names; prod service renamed to `client` everywhere including `pi.toml`. `client/dist` is the build output produced in Task 1 and consumed by `client/Dockerfile` in Task 2.
