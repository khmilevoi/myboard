# browser-automation

Internal service that runs allowlisted, widget-owned browser tasks in one
persistent headed Chromium session under Xvfb. Reachable only on the Compose
network; no public route. See the design specs under `docs/superpowers/specs/`.

## Provisioning secrets (Raspberry Pi)

The passport series and number live as plain-value files under the widget
package, not in the deployment `.env`:

```
packages/widgets/passport-checker/secrets/series
packages/widgets/passport-checker/secrets/number
```

Both are git-ignored; only `series.example`/`number.example` (placeholder
values) are committed, so an operator can see the expected shape without ever
seeing the real values. Fill in the two real files locally (a trailing
newline is fine — the scoped secret reader trims):

```
packages/widgets/passport-checker/secrets/series   # two Ukrainian Cyrillic uppercase letters
packages/widgets/passport-checker/secrets/number   # six digits
```

`AUTOMATION_SSH_TARGET` stays non-secret operational config in the deployment
`.env` (`rpi.toml`'s `[secrets]` still declares `env = ".env"`).

`rpi.toml`'s `[secrets]` section also lists both files under `files`, so `rpi`
delivers them to the Pi verbatim at the same repo-relative path on every
deploy. Send them, restarting the running stack when needed:

```bash
rpi secrets send            # stage the .env values and the two secret files
rpi secrets send --apply    # send and restart the running stack
```

Compose (`docker-compose.yml`) declares `passport_series`/`passport_number` as
file-backed **runtime secrets** sourced from those same paths, mounted only
into `browser-automation` as `/run/secrets/passport-checker_series` and
`/run/secrets/passport-checker_number`. They never appear in the container
environment, image layers, or logs — and being outside the Docker build
context (`.dockerignore` excludes the whole `secrets/` directory), they never
appear in an image layer even transiently during build.

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
slow the default board dev stack. Passport secrets are file-backed and default
to the committed `packages/widgets/passport-checker/secrets/*.example`
placeholders, so no passport env vars are needed to bring it up:

```bash
DIAGNOSTICS_PROBE=ok \
  docker compose -f docker-compose.dev.yml --profile browser up --build browser-automation
```

## Main-server widget gateway

Widget server handlers invoke their own allowlisted browser tasks through
`context.api.browser`. The server uses `BROWSER_AUTOMATION_URL` (default
`http://browser-automation:8788`) and `BROWSER_AUTOMATION_TIMEOUT_MS` (default
`100000`). The deadline is intentionally longer than the browser service's
default queue plus execution limits.

The main server does not depend on browser-automation health or startup. When
the service is absent, only browser task invocations return
`BrowserAutomationUnavailableError`; storage, time, and non-browser widgets
remain available. Calls are never retried automatically.
