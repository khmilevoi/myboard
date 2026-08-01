## Access control

The board is private: nginx `auth_request` gates every route, asset, and API
behind a WebAuthn device session. Anonymous requests to `/` receive the
activation page with status 401 (the deploy healthcheck asserts exactly that).

Ops (from the dev machine via `rpi command` — each is an `rpi.toml`
`[commands]` entry; on the Pi itself the same scripts run via
`docker compose exec server node dist/scripts/<name>.cjs`):

```bash
rpi command create-invite -- --label "Grandma's iPad" --ttl 7d
rpi command list-devices
rpi command list-invites
rpi command revoke-device -- --credential-id <id>
rpi command revoke-invite -- --id <inviteId>
rpi command revoke-account -- --account <accountId>
# Stranded user (lost all devices) — re-enroll into the SAME account:
rpi command mint-add-device-token -- --account <accountId>
# Dated Valkey snapshot into the valkey_data volume (survives FLUSHDB, not volume deletion):
rpi command backup
```

Audit: every register/login/logout/device event is one JSON line in
`docker compose logs server`.

Local gated stack & nginx e2e: the gate is always on in the nginx image, so
`pnpm test:e2e:nginx` needs a stack started from the matching overlay:

```powershell
pnpm start:docker:nginx-e2e
pnpm test:e2e:nginx
```

`docker-compose.nginx-e2e.yml` is that overlay. It enables the `/api/test/*`
seed and reset endpoints (`ALLOW_TEST_DB_RESET`, never set in production) and
re-points the WebAuthn triple at the origin the suite actually drives. Both
halves matter, and neither failure names its own cause:

- `docker-compose.yml` defaults `RP_ID`/`PUBLIC_APP_URL`/`EXPECTED_ORIGIN` to
  the production `https://board.iiskelo.com`. Against `http://localhost:8080`
  the RP-ID mismatch makes `navigator.credentials.create()` reject inside the
  browser, so every passkey journey dies on `сбой процедуры регистрации` with
  `POST /api/auth/register/options` returning 200 and no verify call after it.
- The https origin also makes the server compute `secureCookies: true` and
  issue a `Secure`, `__Host-`-prefixed session cookie, which a browser
  correctly refuses to attach to a plain-`http` local origin — so anything
  depending on the session cookie fails too.

Do not park those three in `.env` instead: `rpi.toml` uses that same file as
its `[secrets].env` bundle, so localhost values there reach production on the
next `rpi secrets push`.

## Deployments

`rpi.toml` deploys production from `main` to `board.iiskelo.com`. `rpi.dev.toml`
is an overlay that deploys the `dev` branch to `board-dev.iiskelo.com` as the
separate project `myboard--dev` — its own containers, network and volumes, so
its Valkey data is fully independent of production and starts empty.

```bash
cp .env.dev.example .env.dev   # once
rpi secrets push --env dev     # after every .env.dev change
rpi deploy --env dev
rpi config show --env dev      # resolved base + overlay, without touching the agent
```

`rpi.dev.toml` clears `[secrets].files` and attaches the `dev` secret group
instead, so `.env.dev` is the whole of this environment's own bundle. The
passport-checker widget's combined plain-value file reaches every stack through
a group pushed once from the repository root — see
`packages/browser-automation/README.md#provisioning-secrets`.

Everything not repeated in the overlay is inherited, so `rpi command` works the
same way with `--env dev`. A fresh dev stack has no devices — mint its own
invite before the gate lets anyone in:

```bash
rpi command create-invite --env dev -- --label "dev laptop" --ttl 7d
```

Two things must stay in sync when changing the dev host (`scripts/infra.test.ts`
enforces both):

- `RP_ID`/`PUBLIC_APP_URL`/`EXPECTED_ORIGIN` in `.env.dev` must match
  `ingress.hostname`. A mismatch does not fail the deploy — it silently breaks
  every WebAuthn ceremony.
- `CLIENT_HOST_PORT`/`VALKEY_HOST_PORT`/`NOVNC_HOST_PORT` must differ from the
  production defaults (8080/6379/6080) and stay outside 8000-8999, the range rpi
  allocates ingress host ports from.

Tear down with `rpi env destroy dev` (stack, volumes, ingress, DNS, secrets), or
`rpi env reset-data dev` to wipe only its data. The overlay sets no TTL, so the
agent's reaper never removes it on its own.
