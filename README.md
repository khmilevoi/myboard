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
`pnpm test:e2e:nginx` needs the stack started with the test endpoints enabled:

```powershell
$env:ALLOW_TEST_DB_RESET = '1'; pnpm start:docker
pnpm test:e2e:nginx
```

Never set `ALLOW_TEST_DB_RESET` in production.

`docker-compose.yml`'s `server` service sets `EXPECTED_ORIGIN` (and
`RP_ID`/`PUBLIC_APP_URL`) to the production `https://board.iiskelo.com`
origin, which makes the server compute `secureCookies: true` and issue a
`Secure`, `__Host-`-prefixed session cookie. A real browser (and Playwright)
correctly refuses to attach that cookie to a plain-`http` local origin such
as `http://localhost:8080`, so running `pnpm test:e2e:nginx` against an
unmodified `docker-compose.yml` fails every test that depends on a session
cookie actually being sent, with no obvious error pointing at the cause. For
a local or CI run, override the `server` service's `RP_ID`/`PUBLIC_APP_URL`/
`EXPECTED_ORIGIN` to an `http` origin matching `playwright.nginx.config.ts`'s
`baseURL` (e.g. `http://localhost:8080`) via a local, untracked
`docker-compose.override.yml` or an equivalent environment override before
starting the stack.
