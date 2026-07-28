# Deploying myboard

Generic `rpi` behavior — the CLI surface, the `rpi.toml` schema, environment overlays, how secret
layers merge — belongs to the `rpi:rpi-cli` and `rpi:rpi-toml` skills. This file records only what
is specific to this repository.

## Targets

`rpi.toml` deploys to a Raspberry Pi target via `docker-compose.yml`, with the `client` service as
the ingress (port 80) and a generous 30-minute build timeout: the SPA build plus the server image
build is slow on Pi hardware. The client image builds every widget remote first, stages them under
`/widgets/<id>/`, and precaches them in the same PWA release. `rpi.dev.toml` and `rpi.branch.toml`
overlay that configuration.

Three targets, each with its own hostname, Valkey volume and device invite:

```bash
pnpm run deploy          # production, board.iiskelo.com          (rpi.toml)
pnpm run deploy:dev      # dev integration, board-dev.iiskelo.com (rpi.dev.toml)
pnpm run deploy:branch   # current branch, board-branch.iiskelo.com (rpi.branch.toml)
```

Use `pnpm run deploy`, not `pnpm deploy` — the latter is pnpm's own built-in command and never
reaches the script.

Extra flags reach the CLI without a separator: `pnpm run deploy:branch --cancel`,
`pnpm run deploy:branch --server home`. Do not add `--` — pnpm forwards the separator itself into
the command, rpi's parser reads a bare `--` as end-of-flags, and everything after it lands as a
rejected positional.

## After a PR merges

The worktree and the branch are not kept around for the release:

```bash
git worktree remove .worktrees/<short-name>
git branch -d feat/<short-name>
git push origin --delete feat/<short-name>   # unless GitHub already deleted it on merge
```

Then deploy dev. Nothing about it is automatic:

```bash
rpi secrets push --env dev   # only after .env.dev changed
rpi deploy --env dev
```

The dev environment runs under the project key `myboard--dev` with its own compose project, network
and Valkey volume, so its data starts empty, and WebAuthn is scoped to `board-dev.iiskelo.com` — it
needs its own device invite (`rpi command create-invite --env dev`).

Once dev is verified, open a PR from `dev` into `main`, merge it, and deploy production with
`rpi deploy`. Keep `dev` a fast-forward ahead of `main`; do not cherry-pick individual commits into
`main`. If dev testing turns up a defect, branch off `dev` again — never patch `main` directly.

## The branch stand

`rpi.branch.toml` is one shared stand for trying the checked-out branch on real hardware, not one
stack per branch. `source.branch` resolves through `${git.branch}`, so rpi reads the branch out of
the checkout and no `--vars` are passed anywhere — `pnpm run deploy:branch`,
`rpi command … --env branch` and `rpi env destroy branch` all take the environment alone.

Since rpi 0.27 the environment key gets a per-branch suffix only when the configuration references
`${env.slug}`; nothing in `rpi.branch.toml` does, so every branch deploys onto the key
`myboard--branch` behind `board-branch.iiskelo.com`, keeping the same volumes. The test device stays
invited and board data survives a branch switch, but the previous branch's service worker,
IndexedDB and Valkey contents are still there afterwards — `rpi env reset-data branch` wipes the
volumes. `rpi config show --env branch` prints a warning about the shared key; that is the intended
configuration, not drift. The environment carries `ttl = "72h"`, so a stand nobody redeploys reaps
itself.

A rebuilt branch project does get a fresh deploy key, and the first deploy can lose the race between
registering it on GitHub and cloning — if `git clone` fails with `Permission denied (publickey)`,
just run the command again.

## Which stack am I looking at

Every non-production stack brands itself, so a screenshot, a tab title or an installed PWA icon
identifies its origin without checking the URL:

| Stack | accent | title / manifest | badge |
| --- | --- | --- | --- |
| `board.iiskelo.com` | violet | `myboard` | none |
| `board-dev.iiskelo.com` | amber | `myboard · dev` | `DEV` |
| `board-branch.iiskelo.com` | raspberry | `myboard · branch` | `BRANCH` |
| `pnpm dev` / `pnpm dev:docker` | teal | `myboard · local` | `LOCAL` |

The name travels `RPI_ENV` → the `APP_ENV` build arg in `docker-compose.yml` → `VITE_APP_ENV` in
`packages/client/Dockerfile` → the `__APP_ENV__` build constant. It is baked into the bundle at
image-build time, so **a stand that comes up violet usually means `APP_ENV` never reached the
build**, not that a CSS rule lost — but rule out the stale-service-worker cause in the next section
first, especially on the shared `branch` hostname. Check `rpi config show --env <name>` for
`RPI_ENV`, then rebuild without a cached client layer.

An unrecognised value fails the build outright, naming the value and the known environments — a
typo can never ship production branding onto a stand.

Recolouring an environment, or adding one to the branding itself, is one entry in
`packages/client/src/shared/app-env/registry.ts` followed by `pnpm icons:generate`; committing the
regenerated `public/env/**` and `icons.lock.json` together is enforced by a unit test. Adding a new
*deploy target* is more than that — it also needs its own `rpi.<name>.toml`, a `.env.<name>`, a
hostname and a `deploy:<name>` script, same as `dev` and `branch` have.

Known accepted limitation: production's activation page references root-absolute icons
(`/favicon.ico`, `/favicon.svg`, `/apple-touch-icon.png`), which fall into nginx's gated catch-all
and come back 401 with the activation HTML instead of the icon — the same failure `location /env/`
exists to prevent on every branded stack. Left open deliberately for production, the one stack that
is not branded, because closing it would change a production response.

## Verifying a deploy in the browser

Nothing about a deployed board is safe to judge on a normal reload. Three separate caches sit
between the build and what runs, and each of them fails silently — the page renders, no error is
logged, and the measurements describe a different release.

**The service worker and IndexedDB survive a redeploy.** The client is a PWA
(`vite-plugin-pwa`, `generateSW`, ~148 precached entries) with offline-first Dexie storage, both
keyed to the origin rather than to the stack. On the shared `branch` hostname that means switching
the env from branch A to branch B leaves A's precache and A's board layout in place. The symptom is
`[Federation Runtime]: Please call createInstance first. #RUNTIME-009` on every widget while the
board shell renders fine — two copies of the module graph, because the cached `remoteEntry.js`
resolves the old chunk hashes. Clear site data (DevTools → Application → Storage) before believing
anything; a hard reload is not enough, the old worker controls the page until the new one activates
and nothing evicts IndexedDB. From a console, the equivalent is:

```js
const regs = await navigator.serviceWorker.getRegistrations()
await Promise.all(regs.map((r) => r.unregister()))
await Promise.all((await caches.keys()).map((k) => caches.delete(k)))
await fetch('/widgets/<id>/remoteEntry.js', { cache: 'reload' })  // then navigate with ?v=N
```

The `{cache: 'reload'}` fetch matters on its own: `remoteEntry.js` also sits in the HTTP disk cache,
which `caches.delete` does not touch.

**URL-stable, content-changing files are exposed to the edge cache.** Almost every asset is
content-hashed, but `/remoteEntry.js` and `/sw.js` are not — their URLs stay put while their
contents change every release, so Cloudflare's default `max-age` served the previous release's copy
and produced the same RUNTIME-009. Both now carry `Cache-Control: no-cache` in
`packages/client/nginx.conf`, asserted by `packages/client/e2e/nginx-smoke.spec.ts`. Any new file
with that shape needs the same rule, and a header only affects the *next* fetch — an object already
at the edge must be purged by URL or waited out.

**So read response headers before reading any bundle.** `cf-cache-status: HIT` with a non-zero `age`
and a `last-modified` older than the deploy is the whole answer. Comparing the chunk hashes in the
console trace against the build log's emitted asset list tells you cache-vs-server directly: a hash
absent from the build log is proof you are looking at cache, not at code. Four plausible causes —
service-worker cache, a missing remote, a host-init race, a stale BuildKit layer — were investigated
and disproved before the edge cache was found, and all four live on the wrong side of it.

## An aborted deploy leaves a container on a dead network

If `rpi deploy` gets past the image build and then fails while starting containers (a host port
still held by another stack, say), Compose has already created every container. The next deploy
recreates only the services whose config it considers changed and leaves the rest — typically
`valkey` — attached to the network from the aborted run. The stack then comes up with every service
`running`, the server logging `getaddrinfo ENOTFOUND valkey` forever, and `client` never becoming
healthy because it depends on the server.

The tell is **ENOTFOUND, not ECONNREFUSED**: a refused connection means valkey is not ready yet, a
name that does not resolve means the containers are on different networks, so waiting cannot help.
`rpi restart` re-attaches a container to the networks it already recorded, and re-running the deploy
skips the container for the same reason it did the first time. The only fix is to recreate:

```bash
rpi rm <project>        # keeps volumes without --volumes
pnpm run deploy:branch  # re-sends the secrets bundle by itself
```

`rpi rm` asks for the project name at an interactive prompt, so an agent with no stdin cannot run
it — ask the user.

## Secrets

Secrets are shared through named groups wherever more than one stack needs the same set.
`rpi.dev.toml` attaches `dev`, `rpi.branch.toml` attaches `["dev", "branch"]`, and both clear
`[secrets].files`; `[secrets].env` / `files` in each file is the local source a push reads, never a
deploy-time input.

```bash
rpi secrets push                                 # production: .env + the passport-checker files
rpi secrets push --group dev                     # the same files, for dev and the branch stand
rpi secrets push --group branch --env branch     # .env.branch, the stand's own configuration
rpi secrets push --env dev                       # dev's own .env.dev
```

Production deliberately has no group. It would be the only project attaching one, and a keyless push
always writes the same content into the deploy key's own bundle, which is the last layer — so the
group would sit shadowed by an identical copy, and a rotation pushed only to it would never reach
production.

The branch stand's own configuration lives in the `branch` group rather than in the environment's
bundle, which stays empty. Two things follow. Groups belong to the base project, so neither
`rpi env destroy branch` nor the TTL reaper takes the configuration down with the stand — a stand
that reaped itself is still configured when it is deployed again. And a *declared* group that is
missing or empty fails the deploy at the layer-load step, before the checkout is written and long
before the ~3-minute image build, naming the group and the push that fixes it — where a missing
bundle of its own would have deployed silently unconfigured, with the WebAuthn gate on production's
hostname and this stack fighting the others for their host ports. That is why `deploy:branch` is a
bare `rpi deploy --env branch` and needs no script around it.

Layers apply in the order declared, with the environment's own bundle always last — so for the
branch stand `branch` overrides `dev`, and anything pushed to its deploy key overrides both.
`rpi secrets ls [--env <env>]` shows which layer wins every entry, which is how you catch a stale
copy in a bundle shadowing the group it should be reading.
