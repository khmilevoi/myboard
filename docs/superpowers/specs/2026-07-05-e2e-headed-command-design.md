# Headed e2e run with Dockerized Valkey — design

## Goal

Add `pnpm test:e2e:docker:headed`: run the board's Playwright e2e suite (`packages/client/e2e`, `playwright.config.ts`) in headed mode (a real, visible Chromium window) so a developer can watch what's happening, while the disposable Valkey dependency still runs in Docker.

## Why not full containerization (rejected)

`packages/browser-automation` already carries an Xvfb + x11vnc + noVNC stack for a genuine production reason (remote CAPTCHA recovery on a headless Pi). Reusing that pattern for local e2e debugging would mean:
- 3 extra daemons (Xvfb, x11vnc, websockify) baked into `packages/client/e2e.Dockerfile`.
- A new entrypoint script replacing the current one-line `CMD`.
- Only a *stream* of the browser (via noVNC), not real interaction — you can watch, not click.

Since `packages/server/src/test-server.ts` only needs `VALKEY_URL` to reach Valkey, and Playwright's `webServer` blocks in `playwright.config.ts` already build/start the server and client on the host, the only piece that needs Docker is Valkey. Running Playwright itself on the host gives a real native browser window with none of the above complexity.

## Design

**New script: `scripts/test-e2e-docker-headed.ts`** (run via `tsx`, matching `scripts/codegen.ts` convention)

1. Starts only the `valkey` service from `docker-compose.e2e.yml` in detached mode, with its port published to the host (`127.0.0.1:6379:6379` — not currently published in that compose file; this script adds the mapping via `docker compose run`/`up` flags, not by editing the compose file's checked-in service definition long-term — see Compose changes below).
2. Waits for the compose health check to report healthy (`docker compose ... up -d --wait valkey`).
3. Spawns `pnpm --filter client exec playwright test --headed` as a child process with `VALKEY_URL=redis://localhost:6379` and `ALLOW_TEST_DB_RESET=1` injected into its env (via `child_process.spawn(..., { env })`, not shell string interpolation — Windows-safe).
4. Forwards the child's exit code as the script's own exit code.
5. In a `finally` (and on `SIGINT`/`SIGTERM`), tears the Valkey container down: `docker compose -f docker-compose.e2e.yml down -v`.

**Compose changes: `docker-compose.e2e.yml`**
- Add a `ports: ['127.0.0.1:6379:6379']` entry to the `valkey` service. This is a static, always-present mapping (compose has no clean way to make it conditional), but it's loopback-only and only bound while this script (or `test:e2e:docker`, which doesn't need the port but is unaffected by it being present) is running.

**Root `package.json`**
- New script: `"test:e2e:docker:headed": "tsx scripts/test-e2e-docker-headed.ts"`.

**No changes** to `packages/client/e2e.Dockerfile`, `playwright.config.ts`, or the existing `test:e2e:docker` / `test:e2e:docker:down` flow.

## Error handling

- If `docker compose up -d --wait` fails (Docker not running, port already in use, etc.), the script exits non-zero with Docker's own error output; no Valkey container is left half-started to clean up (compose handles that).
- If Playwright itself fails/crashes, the script still runs teardown before exiting with Playwright's exit code.

## Testing

- Extend `scripts/infra.test.ts` with assertions that:
  - `docker-compose.e2e.yml` publishes `127.0.0.1:6379:6379` for `valkey`.
  - `package.json` wires `test:e2e:docker:headed` to `tsx scripts/test-e2e-docker-headed.ts`.
- No new Vitest unit tests for the orchestration script itself (it's a thin process-spawning wrapper around Docker CLI + Playwright CLI, both external processes) — manual verification (running the command) is the practical check, consistent with how `test:e2e:docker` itself is verified.
