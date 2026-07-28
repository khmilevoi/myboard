# Widget server functions

## Authored records go through the widget's own `server.ts`

Widgets that write shared state do it from their own `server.ts` rather than through
`POST /api/storage/:key/append`: the widget dispatch route resolves the session cookie into
`WidgetServerContext.viewer`, so the record's author is stamped by the server from the caller's own
session and never travels in the request body. The UI therefore cannot sign a record with someone
else's name.

This is not an authorization boundary. `POST /api/storage/:key/append` is still reachable by anyone
nginx has already let in, and it writes the body as given, so a signed-in household member can
hand-write a record carrying any author into a widget's key. The generic storage route stays a
shared trusted channel inside the board.

`WidgetRuntimeProps.identity` gives the client side the same roster (`GET /api/auth/accounts`) for
display — records store an `accountId` plus a frozen name, and display resolves through the
directory, so renames and avatars reach old records.

## Crons

A widget's `server.ts` may also declare `crons: { <name>: { schedule, timeZone, run } }`. The tick
scheduler in `packages/server/src/widgets/cron-scheduler.ts` runs them on the app's injected clock,
keeps a cursor per job at `cron:<typeId>:<jobName>` in Valkey, and catches a missed occurrence up
exactly once — **so handlers must be idempotent**.

A cron context has no `viewer` and no instance scope: a background run has no caller, so a job that
writes an authored record supplies the author itself. In test mode the interval is off and
`POST /api/test/cron/tick` drives one pass.

## Bundling constraint

`server.ts` and everything it reaches are bundled into the server image, which installs nothing but
`packages/server`'s production dependencies. Logic shared with the widget's `model/` therefore lives
in `packages/widgets/*/domain/`, whose import allowlist — `zod`, `@shared/*`, `./` siblings, JS and
Temporal globals — is enforced by the `.oxlintrc.json` override.

## Registration

Each root `server.ts` exports schemas and handlers **without** a `typeId`; `pnpm codegen:server`
builds the registry from widget directory names and injects the basename, without loading any client
code.
