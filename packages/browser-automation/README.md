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
deploy. They travel in a **secret group** rather than in each environment's own
bundle: `rpi.toml` attaches `prod`, and both overlays attach `dev` with
`[secrets].files` cleared. Push each group once from the repository root, and
restart the running stack when the values change:

```bash
rpi secrets push --group prod    # production's copy of the two secret files
rpi secrets push --group dev     # the copy dev and the branch stand share
```

A group push writes to the store and stops there. To land rotated values on a
running stack without a full deploy, follow it with `rpi secrets push --apply
[--env <env>]`, which re-resolves that key's whole layer stack — every declared
group, then its own bundle — and recreates the affected containers.

A declared group that was never pushed fails the deploy naming the group.
`rpi secrets ls [--env <env>]` shows which layer every entry comes from
(`<- key` for the environment's own bundle, `<- group dev` for a group), which
is also how you confirm the files are no longer duplicated per environment.

Compose (`docker-compose.yml`) declares `passport_series`/`passport_number` as
file-backed **runtime secrets** sourced from those same paths, mounted only
into `browser-automation` as `/run/secrets/passport-checker_series` and
`/run/secrets/passport-checker_number`. They never appear in the container
environment, image layers, or logs — and being outside the Docker build
context (`.dockerignore` excludes the whole `secrets/` directory), they never
appear in an image layer even transiently during build.

## Browser recovery: embedded panel and SSH fallback

When a task reports that browser attention is required, the normal path is
embedded recovery from the board itself: opening the widget's recovery panel
mints a single-use capability valid for about 60 seconds and opens one
same-origin WebSocket straight to the retained page. No SSH tunnel, no
separate noVNC tab.

Only one recovery session may be active service-wide at a time. A session ends
whenever any of the following happens first: 15 minutes elapse, the operator
disconnects, or the widget runs its task again (a retry revokes the session and
tears down the socket before the new task is dispatched, so a connected
operator never has the page pulled out from under them mid-view — the retry
simply wins).

The VNC port is still published only on the Pi loopback (`127.0.0.1:6080`), so
the SSH fallback is unchanged and remains available for when the board itself
is unreachable:

```bash
ssh -L 6080:127.0.0.1:6080 $AUTOMATION_SSH_TARGET
# then open http://127.0.0.1:6080 locally, solve the challenge, close the tunnel
```

Press Retry in the widget afterward. The same browser process and profile stay
active throughout.

A recovery session — embedded or over the SSH-tunnelled noVNC — controls the
entire shared X display, not a per-widget view. Anyone who opens one can see
and drive every page in the persistent Chromium profile, not just the widget
that requested recovery.

## Requesting manual input from a widget task

A browser task that cannot finish without a human — a Cloudflare challenge, a
login wall, a captcha — asks the platform to escalate instead of assembling the
escalation itself:

```ts
import { makeCloudflarePageDetector } from 'browser-automation/user-input/cloudflare'

const navigation = await context.page.goto(url, { waitUntil: 'domcontentloaded' })

const escalation = await context.detectUserInput(makeCloudflarePageDetector(navigation))
if (escalation instanceof Error) return escalation
```

`detectUserInput` runs the detector against the live page. If it matches, the
platform retains the page for manual recovery and returns `UserInputRequiredError`
(`code: 'browser_session_required'`), which the widget server turns into HTTP 409
and the client turns into the noVNC recovery view. If the detector cannot decide,
it returns `UserInputProbeError` (`code: 'user_input_probe'`) and leaves the page
unretained. Otherwise it returns `null`.

Retention is not separately reachable: a task cannot hold a page open without
escalating, or escalate without leaving a page behind.

When the evidence does not come from the DOM — for example a `fetch` response
body read inside the page — classify it directly and, if the retained page needs
to be brought into a state a human can act on, pass a `prepare` hook. It runs
only when the detector matched, before the page is retained, and its failure is
logged without cancelling the escalation:

```ts
import { makeCloudflareEvidenceDetector } from 'browser-automation/user-input/cloudflare'

const escalation = await context.detectUserInput(makeCloudflareEvidenceDetector(evidence), {
  prepare: (page) => page.goto(url, { waitUntil: 'domcontentloaded' }),
})
```

A detector is any `(page) => Promise<Error | boolean>`, so a widget facing
something other than Cloudflare writes its own and gets the same handling.

`AUTOMATION_SSH_TARGET` is read once by the service config and attached to the
escalation error as public `sshTarget` meta; widgets neither read nor pass it.
An unusable value degrades to no hint rather than failing service startup.

## Profile volume

The Chromium profile lives in the named volume `browser_profile` at `/profile`.
It survives image rebuilds and container restarts, preserving the session
(including `cf_clearance`). Do not delete it to "fix" a problem; surface a
recovery instead.

Because the volume outlives the container, `SingletonLock`, `SingletonCookie`,
and `SingletonSocket` can still name the `<hostname>-<pid>` of a container that
is gone, and Chromium then refuses to start ("The profile appears to be in use
by another Chromium process ... on another computer"). The executor removes
those three entries before every launch. That is safe only because the container
runs a single browser-automation process with one persistent context — never
point a second Chromium at this volume.

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
