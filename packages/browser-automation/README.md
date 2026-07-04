# browser-automation

Internal service that runs allowlisted, widget-owned browser tasks in one
persistent headed Chromium session under Xvfb. Reachable only on the Compose
network; no public route. See the design specs under `docs/superpowers/specs/`.

## Provisioning secrets (Raspberry Pi)

Passport identity and the SSH target are provisioned through the `pi` CLI's
deployment `.env` (never committed). Note: as of this writing `rpi.toml` does
not yet declare an `[env]` section; provisioning still flows through the
`pi env send` mechanism described below, but the `.env` wiring in `rpi.toml`
itself is pending and should be added before relying on this in production.

```
PASSPORT_SERIES=<two Ukrainian Cyrillic uppercase letters>
PASSPORT_NUMBER=<six digits>
AUTOMATION_SSH_TARGET=<ssh target for the Pi>
```

Send them, restarting the running stack when needed:

```bash
pi env send            # stage values for the next deploy
pi env send --apply    # send and restart the running stack
```

Compose (`docker-compose.yml`) exposes `PASSPORT_SERIES`/`PASSPORT_NUMBER` as
**runtime secrets**, mounted only into `browser-automation` as
`/run/secrets/passport-checker_series` and `/run/secrets/passport-checker_number`.
They never appear in the container environment, image layers, or logs.

## Cloudflare recovery over SSH

When a task reports that browser attention is required, complete the challenge in
the already-running session through an SSH-tunnelled noVNC (the port is bound to
the Pi loopback only):

```bash
ssh -L 6080:127.0.0.1:6080 $AUTOMATION_SSH_TARGET
# then open http://127.0.0.1:6080 locally, solve the challenge, close the tunnel
```

Press Retry in the widget afterward. The same browser process and profile stay
active throughout.

## Profile volume

The Chromium profile lives in the named volume `browser_profile` at `/profile`.
It survives image rebuilds and container restarts, preserving the session
(including `cf_clearance`). Do not delete it to "fix" a problem; surface a
recovery instead.

## Diagnostics probe

Verify the browser after a deploy, from inside the Compose network:

```bash
docker compose exec server \
  node -e "fetch('http://browser-automation:8788/tasks/__diagnostics__/browser-check',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(r=>r.json()).then(console.log)"
```

A healthy response is `{ "ok": true, "result": { "ok": true, "secretPresent": <bool>, "userAgent": "..." } }`.
`secretPresent` is `true` only when a `/run/secrets/__diagnostics___probe` file is
mounted (the dev stack mounts a fake one via the `DIAGNOSTICS_PROBE` env var;
production does not mount this secret at all).

Note: port `8788` is only reachable inside the Compose network in production
(`expose: ['8788']`, not published to the host); the dev stack additionally
publishes it at `127.0.0.1:8788` for direct local access.

## Local development (non-Docker)

Headed Chromium runs on your native display; no Xvfb needed.

```bash
pnpm --filter browser-automation exec playwright install chromium   # one time
BROWSER_PROFILE_DIR=.dev-profile BROWSER_SECRETS_DIR=.dev-secrets \
  pnpm --filter browser-automation dev
```

`.dev-profile/` and `.dev-secrets/` are git-ignored. Create fake scoped secret
files under `.dev-secrets/` (e.g. `.dev-secrets/__diagnostics___probe`) as needed.

`pnpm --filter browser-automation dev` runs `tsx watch src/index.ts` (see
`packages/browser-automation/package.json`).

## Docker development

The dev browser service is behind the `browser` Compose profile so it does not
slow the default board dev stack:

```bash
PASSPORT_SERIES=АА PASSPORT_NUMBER=123456 DIAGNOSTICS_PROBE=ok \
  docker compose -f docker-compose.dev.yml --profile browser up --build browser-automation
```
