# Backlog

Known follow-ups that are deliberately not scheduled. Each entry states what
exists today, why it is tolerable, and what would trigger doing the work.

## Shared modal/overlay primitive for widgets

**Today.** `packages/widgets/passport-checker/ui/use-modal-isolation.ts` is a
hand-rolled modal implementation owned by one widget. It reimplements Escape
handling, a Tab focus trap, focus containment, mount/unmount focus hand-off and
press-based backdrop dismissal, and it does so with `window`-capture listeners
specifically to win against a modal `radix-ui` layer the widget cannot patch —
the board's fullscreen dialog. The widget's overlay also needs an explicit
`pointer-events: auto` because a Radix modal layer sets `pointer-events: none`
on `document.body`.

**Why it is tolerable.** After the tier-shared-state work
([design](./docs/superpowers/specs/2026-07-25-passport-checker-tier-shared-state-design.md))
recovery collapses fullscreen before opening, so in production the modal is the
only layer on screen. The stacked configuration survives only as a degenerate
fallback, covered by `ui/recovery-modal-radix-stack.test.tsx`.

**Why it should not stay.** The isolation is coupled to Radix internals rather
than to a contract: it depends on `FocusScope.handleFocusOut` inspecting only
`relatedTarget` and never `event.target`, and on `FocusScope` restoring focus
from a `setTimeout(…, 0)` on unmount. Both are implementation details that can
change in a patch release and fail silently — no type error, no test failure
outside the one stack test we wrote on purpose. A second widget needing a modal
would copy all of it.

**Shape to consider.** Either a host-owned overlay slot — `widget-host` renders
widget-requested overlays outside the fullscreen dialog, so nothing is ever
stacked and no isolation is needed — or a `widget-sdk` modal primitive built on
the same Radix layer stack the board itself uses, so layering is coordinated
instead of fought. The host-slot option is the stronger one: it removes the
problem rather than centralising the workaround.

**Trigger.** A second widget needs a modal, or a `radix-ui` upgrade breaks the
stack test.

## Two simultaneously-mounted `useModalIsolation` modals ping-pong focus

**Today.** `packages/widgets/passport-checker/ui/use-modal-isolation.ts`
registers its focus-containment `focusin` handler on `window` in the CAPTURE
phase (`use-modal-isolation.ts:76`), while the `stopPropagation()` that keeps a
modal's own `focusin` off `document` sits on the modal root
(`use-modal-isolation.ts:55`) with no capture flag, so it runs on the BUBBLE
phase — after every window-capture listener, including the other mounted
modal's, has already fired. Two mounted modals therefore each see the other's
`focusin` first, find the target outside their own root, and pull focus back
into themselves, each move re-triggering the other. Measured in jsdom 29.1.1
with two `useModalIsolation` roots mounted at
once: a single modal performs 1 focus pull on mount, while two mounted together
run away without settling — a hard test guard at 400 pulls had to stop them (402
recorded, and the true count is unbounded).

**Why it is tolerable.** It is not reachable through the UI. The passport
checker is the only owner of a `useModalIsolation` modal, and it renders at most
one: `<RecoveryModal />` is rendered only from the non-fullscreen mount
(`PassportChecker.tsx:72`). A second one cannot be opened over the first either
— the overlay is `position: fixed; inset: 0` with `pointer-events: auto`
(`recovery-modal.module.css:1-13`) and its `pointerdown` handler closes the
modal on any press that starts on the overlay
(`use-modal-isolation.ts:50-53`), so nothing behind it can be clicked.

**Shape to consider.** A module-level stack of active modal roots: each
`useModalIsolation` effect pushes its root on mount and pops it on cleanup, and
the containment handler returns immediately unless its own root is the topmost
entry. Only the top modal contains focus, so there is no second handler left to
pull against. This also generalises cleanly to the shared modal primitive the
entry above describes.

**Trigger.** A second widget adopts `useModalIsolation`, or the passport checker
ever renders two of its modals at once (e.g. the fullscreen-mount guard at
`PassportChecker.tsx:72` is relaxed, or a second modal surface is added).

## A poisoned cron cursor bricks its job permanently

**Today.** `packages/server/src/widgets/cron-scheduler.ts` reads the job's cursor
and, when the read fails, logs and returns. The reseed that would recover it is
gated on `state === null`, so a value that exists but does not parse is never
repaired: every subsequent 30s tick takes the same branch and the job never runs
again. A transient Valkey error self-heals on the next tick; a bad _value_ does
not. No test covers the branch — the one that looks like it does passes because
the ofelia job no-ops on an absent ledger regardless of what the scheduler did.

**Why it is tolerable.** `writeCronState` is the only writer and cannot emit a
schema-invalid value: both call sites pass numbers. The reachable ways in are a
future release adding a required field to `CronStateSchema` without a migration,
an operator hand-editing the key, or a container kill mid-write. The blast radius
is one job silently stopping, which for the only current consumer means duty days
stop auto-closing — visible in the widget within a day.

**Shape to consider.** Treat an unparseable cursor as corruption rather than as a
transient error: log it and reseed to `now`, the same as first sight. That trades
"catch up an unknown amount" for "resume cleanly", which matches the handler
idempotency the whole design already assumes. Add a test that seeds a garbage
value and asserts the job runs again on the next tick.

**Trigger.** A second widget declares a cron, or `CronStateSchema` gains a field.

## The server never drains the cron scheduler on shutdown

**Today.** `packages/server/src/index.ts` installs no `SIGTERM`/`SIGINT` handler,
so `cronScheduler.stop()` never runs in production and a container stop can
interrupt a pass between two appends.

**Why it is tolerable.** The cursor only advances after a pass completes, so an
interrupted run replays, and the handlers are idempotent by contract — the ofelia
job re-reads each day's resolution before appending, so a replay writes nothing
twice. `stop()` exists and is exercised in tests; it is only unreachable in the
deployed process.

**Shape to consider.** A single shutdown hook that closes the HTTP server, stops
the scheduler and quits the Valkey clients. It is worth doing for the SSE
connections and the Valkey subscriber too, not only for the cron.

**Trigger.** A cron handler that is genuinely not idempotent, or a deploy that
strands connections.

## One malformed record fails every widget's server-side read

**Today.** `packages/server/src/widgets/storage.ts` validates a whole fetched
value with `schema.safeParse` and returns a `storageError` when it fails. For the
array-shaped keys widgets actually use, a single bad element therefore fails the
entire read. The ofelia widget's own _client_ schemas were made element-tolerant
during the PR #27 review; the server path was not.

**Why it is tolerable.** No production writer can produce a bad element: widget
server handlers construct records from typed builders. The reachable ways in are a
hand-written `POST /api/storage/<key>/append`, which is a trusted channel inside
the household by design, or a future schema change without a migration.

**Shape to consider.** Offer an element-tolerant read for array-shaped keys in
`makeWidgetScopedStorage`, mirroring what `domain/ledger.ts` and
`domain/comments.ts` now do on the client, so one poisoned row degrades a list
instead of disabling a whole widget's server side.

**Trigger.** A widget stores an array whose element shape changes, or a hand-run
append corrupts a key in practice.

## The nightly auto-close overrides a deliberate reopen

**Today.** `undo` writes a `reset`, which leaves the day `pending`. The
auto-approve cron closes every unresolved day in its seven-day window, so a day
reopened on purpose is re-closed the following night with a system-signed
`cleaned`.

**Why it is tolerable.** It is the specified policy, tested contemporaneously, and
the PR #27 description states it: record «в долг» rather than `reset` if a day
should stay unsettled. The seven-day bound is deliberate.

**Shape to consider.** If the reopen should be durable, the ledger needs a state
the cron treats as "left open on purpose" — distinct from "nobody got round to
it" — rather than another window tweak.

**Trigger.** Someone reopens a day and is surprised the next morning.

## The ofelia ledger grows without bound

**Today.** One record per day forever, plus one per user action, with no cap and
no retention. Every append rewrites the whole JSON array under one key and
publishes an SSE event, so the cost grows with the square of the record count,
not linearly.

**Why it is tolerable.** A household board writes a few records a day; a year is
a few hundred. Nothing degrades at that size.

**Shape to consider.** Fold records older than the debt horizon into a carried
balance and drop them, or shard the key by month. Both change the history view,
so it is a product decision before it is a storage one.

**Trigger.** The ledger read shows up in a slow widget mount, or the history list
becomes unusable to scroll.

## `POST /api/storage/:key/append` still writes whatever body it is given

**Today.** The PR #27 review fenced the generic storage routes off the auth,
scheduler and session keyspaces, so `session:`, `account:`, `device:`, `invite:`
and `cron:` are unreachable. Within the allowed `root:`/`w:i:`/`w:t:` namespaces
the route is still an unauthenticated-within-the-household shared channel: it
writes the body verbatim, so a signed-in member can hand-write a record carrying
any author into a widget's key.

**Why it is tolerable.** This is the documented design — CLAUDE.md calls the
generic storage route a shared trusted channel inside the board, and the
authorship guarantee the release added is about what the _UI_ can sign, not about
what a determined household member with devtools can. Everyone past the WebAuthn
device gate is already trusted with the board's contents.

**Shape to consider.** If widget records ever need to be authorization-bearing
rather than merely attributed, the append route needs the same session→account
resolution the widget dispatch route has, and widget keys need to stop being
writable through the generic route at all.

**Trigger.** A widget stores something where a forged author has consequences
beyond display.

## The client and server images never see `browser-automation`'s manifest

**Today.** Both `packages/client/Dockerfile` and `packages/server/Dockerfile` run
`pnpm install --frozen-lockfile` without copying
`packages/browser-automation/package.json`, while
`packages/widgets/passport-checker` declares a `workspace:*` dependency on it.

**Why it is tolerable.** `--frozen-lockfile` skips resolution when the lockfile
matches, so the missing manifest is never consulted. Nothing the client build
touches imports the package — only `browser.ts` and `browser/*` do, which the
federation build never reaches.

**Shape to consider.** Copy the manifest in both images alongside the others, so
the install layer describes the workspace it actually installs.

**Trigger.** Any lockfile drift that forces re-resolution — at which point the
image build fails on the Pi with an opaque `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`,
after the full build time has already been spent.

## The nginx-image e2e specs run only in their own project

**Today.** `packages/client/playwright.config.ts` excludes `nginx-smoke`,
`nginx-gate` and `nginx-rate-limit` from the default project; they run only under
`playwright.nginx.config.ts` via `pnpm test:e2e:nginx`, which needs a
production-style Docker stack already up. So the assertions guarding the
Cloudflare stale-`remoteEntry` fix, the new `/sw.js` cache header, the storage
allowlist and the CSRF gate are in neither `pnpm check` nor
`pnpm test:e2e:docker`.

**Why it is tolerable.** The split is deliberate — those specs need a real nginx
image, which the dockerized board e2e does not build. The command is documented.

**Why it should not stay.** The regressions they guard are exactly the ones that
are invisible in review and surface hours after a deploy. With no CI, a gate
nobody remembers to run is not a gate.

**Shape to consider.** Fold the nginx project into `test:e2e:docker` so one
command covers both, or make `pnpm check` fail loudly when the nginx suite has
not been run against the current `nginx.conf`.

**Trigger.** Any change to `nginx.conf`, or a release where the edge serves stale
assets again.

## The comment handler trusts a client-supplied week key

**Today.** The `comment` handler in
`packages/widgets/ofelia-poop-duty/server.ts` passes `weekStart` straight into
`commentsKey(weekStart)` without checking it is a Monday, so a request naming any
date creates a comment thread under a key no client will ever read back.

**Why it is tolerable.** Every producer normalizes: the model derives
`weekStartISO` from the viewed week. Reaching it needs a hand-crafted request from
someone already past the device gate, and the outcome is self-inflicted and
non-destructive — a comment nobody sees.

**Shape to consider.** Normalize to the week start server-side, or validate it in
the payload schema, so the key shape is derived from the same rule on both sides
rather than trusted from the wire.

**Trigger.** A second client or an automation posts comments.

## Ofelia's tier thresholds sit within 10 px of their own frames

**Today.** `ofelia-poop-duty` declares `standard.minWidthPx: 400` and
`minHeightPx: 300`. Now that the board measures its real container, a `w: 4`
card is a 393 px frame at a ~1280 px viewport — so it renders `CompactTier`
there — and the `h: 8` default is a 308 px frame, 8 px above the height
threshold. Because the board's lower scale clamp is `1`, that 8 px of headroom
is the same at every desktop width.

**Why it is tolerable.** The user's devices are one phone plus 1920x1080 and
3840x2160 desktops, so neither margin is hit in practice. The width threshold
was calibrated against the pinned-1280 measurement bug, i.e. against a number
wrong by 55 px, and nothing has needed it since.

**Why it should not stay.** Any chrome added inside the card silently drops
ofelia to `compact` and takes five e2e tests with it, with no error and no
obvious cause. Raising `defaultSize.w` would not rescue existing boards, whose
`w` is already persisted in the stored layout.

**Trigger.** A ~1280 px screen enters the household, or anything is added to the
card's header or footer.

## An old client bundle cannot parse a new record shape

**Today.** Widget record schemas are `z.array(...)`, so a single record carrying
a field an older bundle's schema rejects fails the whole parse — and a
still-open client hangs on its loading skeleton permanently, not just for that
row. It has happened twice: the authored ledger's `createdBy`, and the cron's
`{ system: true }` author. Both releases shipped compat shims that keep writing
the legacy `ip`/`by`/`author` fields for one release, each with its removal
condition recorded at the shim.

**Why it is tolerable.** Force-reloading every open client after a deploy fixes
it, and the shims cover the window where that has not happened yet.

**Why it should not stay.** The failure is silent, total for the widget, and
lands on the wall tablet — the one client nobody reloads. Every future record
field repeats it, and every release adds another shim to remember to remove.

**Shape to consider.** Parse per element and drop unreadable rows rather than
failing the array, so an unknown field costs one row instead of the widget.

**Trigger.** A third record-shape change, or the first shim that outlives its
stated removal condition.

## An ofelia comment from outside the duty rotation loses its author

**Today.** A comment written by an account whose name is not in
`DUTY_ROTATION` is stored with no legacy `author` field, so a pre-release client
loses that entire week's thread until it reloads.

**Why it is tolerable.** Every current household account is in the rotation, and
the alternative considered — synthesizing an author — writes a permanent false
attribution into an append-only store.

**Trigger.** An account named outside the rotation is created.

## The PWA update path has no manual affordance and can lag an hour

**Today.** `registerType: 'autoUpdate'` with `injectRegister: null` makes
`vite-plugin-pwa@1.3.0` set `workbox.skipWaiting`/`clientsClaim` (`dist/index.js:874`),
and its `dist/client/build/register.js` auto branch reloads the page itself on
`activated` when `isUpdate || isExternal`. A new release does land on its own. But
that same branch never calls `onNeedRefresh`, and `updateServiceWorker()` opens with
`if (!auto) sendSkipWaitingMessage()` — so in auto mode it is a no-op. `needRefreshAtom`
and `applyUpdate()` (`packages/client/src/app/model/pwa.ts`) and `UpdateBanner`
(`app/ui/App.tsx:25`) are therefore dead code. The only update check an already-open
client performs is `pwa.ts`'s hourly `registration.update()`.

**Why it is tolerable.** `packages/client/nginx.conf` sends `Cache-Control: no-cache`
for `/sw.js` and every `remoteEntry.js`, so a plain navigation picks a new release up,
and most clients navigate often enough.

**Why it should not stay.** A standalone PWA resumed from the background does not
navigate, so the wall tablet can sit up to an hour on the previous release — the one
client nobody reloads, and the same client that "An old client bundle cannot parse a
new record shape" above already lands on. Meanwhile the banner advertises a manual
escape hatch that cannot fire, and pressing it calls a function that returns
immediately.

**Shape to consider.** Re-check on `visibilitychange` and `online` alongside the timer,
guarded the way Vite PWA's periodic-updates guide does it: skip while `r.installing`,
skip when offline, and only call `r.update()` after `sw.js` answers 200. Then pick one
of the two update models instead of half of each — delete
`needRefreshAtom`/`applyUpdate`/`UpdateBanner`, or move to `registerType: 'prompt'`,
where `onNeedRefresh` does fire and the banner earns its place. Auto mode reloads
without asking, which interrupts a drag; `onNeedReload` is the lever if that matters.

Note that none of this touches IndexedDB: a service-worker update never evicts Dexie,
which is why the shared `board-branch` hostname still needs site data cleared by hand
when switching branches.

**Trigger.** A release has to reach the wall tablet promptly, or someone tries to use
the update banner.
