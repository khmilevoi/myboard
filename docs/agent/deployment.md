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
