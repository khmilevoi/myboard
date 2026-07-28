# Browser history traversal is asynchronous, and jsdom hides it

## The question

Does `history.go(-1)` / `history.back()` move the browser synchronously? And if a `pushState` call
follows it in the same synchronous task, does the browser cancel the pending traversal the way jsdom
does?

This matters for any code that treats a history traversal as instantaneous, or that assumes a
`pushState` right after a `go()`/`back()` cancels it. `overlay-history.ts` in `widget-runtime` is
exactly that code: it mirrors open overlays onto history entries so the platform back gesture can
close them, and its traversal-scheduling logic exists entirely because of the answer below.

## The method

Real Chromium (`@playwright/test`, not jsdom), driven through `page.evaluate` against a static HTML
page with no framework involved — just `history.pushState` / `history.go` / `popstate`
instrumentation. Two real navigations first, so there was a genuine prior entry to return to, then:
push an "overlay" entry, call `history.go(-1)`, and — in the same synchronous task — `pushState` a
second "overlay" entry. Every `history.state` / `history.length` / `location` read and every
`popstate` was logged with a timestamp.

## What happens

`history.go(-1)` does not move anything synchronously. `history.state` and the URL are unchanged
immediately after the call returns. The traversal it queues fires later — measured between 16ms and
42ms across separate runs, consistently inside a single browser task and not tied to a rendering
frame.

A `pushState` issued in that window does **not** cancel the queued traversal. The pushed entry is not
deleted from session history, but the traversal still fires and wins: it snaps `current` back to
whatever entry it resolved against *at the moment `go()` was called*, silently overriding the fact
that `pushState` had just made a different entry current. The pushed entry survives, just unreachable
except by then pressing forward. The app receives a `popstate` for an entry it never asked to return
to, with no user input at all.

A `setTimeout(0)` inserted between the `go()` / `back()` call and the following `pushState` does not
dodge this: its callback runs in well under a millisecond, far ahead of the 16-42ms the real traversal
takes, so it produces byte-identical results to doing both calls in the same tick. Only a delay
comfortably past the observed latency (300ms in the probe) lets the traversal finish first; at that
point `pushState` behaves exactly as expected and a single subsequent `back()` closes cleanly — this
is the "textbook", no-race case, useful as a sanity check against the raced one.

`history.length`, read by simple polling, can also lag: it reported a stale count until another real
navigation (a `forward()` call) refreshed the renderer's cached copy. Do not treat one polled
`history.length` read as proof that an entry was added or removed.

## jsdom does not reproduce this

jsdom cancels a pending traversal task as soon as `pushState` runs (`clearHistoryTraversalTasks()`,
`jsdom/lib/jsdom/living/window/History-impl.js`), so the exact sequence above — `go()` then a
same-tick `pushState` — behaves correctly under jsdom and incorrectly in a real browser. A Vitest
suite that only dispatches synthetic `PopStateEvent`s, or that never actually races a `pushState`
against a pending `go()`, cannot see this class of bug at all: the code can be green under jsdom and
still show a dialog flash open and shut in production.

## Consequence for `overlay-history.ts`

The module never issues a history traversal for a dropped overlay inline. If it did, the one sequence
React produces constantly — a drop immediately followed by a push, in one synchronous task — would hit
this race on every occurrence: `StrictMode`'s mount → cleanup → mount does it on every overlay mount,
and so does any state change that closes one overlay and opens another in the same commit. The push
would make the new overlay's entry current; the drop's already-queued traversal would then land 16-40ms
later, roll the browser back past it, and hand the app a spontaneous `popstate` at the pre-overlay
depth — indistinguishable from a real back press, closing an overlay that had opened milliseconds
earlier.

Instead, a dropped overlay's traversal is recorded as a depth owed and deferred to the next task. A
push arriving before that flush reuses the entry the drop still owes, so no traversal is issued at
all — nothing to race. A drop with nothing behind it flushes on its own schedule and behaves exactly
like an eager traversal would, because there is no push left to race against.

The deferral does not close the window completely. Once the flush itself calls `history.go`, that
traversal is in flight for another 16-40ms before its `popstate` arrives, and there is no signal for
"a traversal is currently in flight" — only for depths still owed. A push landing inside that specific
gap reads a stale depth, the same way an eager traversal would have. No current call site reaches
this: React batches a same-commit drop and push into one task, so nothing today spans the gap between
the flush firing and its `popstate` landing.

## For anyone touching this module

- Do not turn the deferred flush into an inline traversal. That reintroduces the exact race measured
  above, and a green Vitest run will not catch it.
- Do not trust a jsdom-only test to validate a change to the traversal-scheduling logic. jsdom's
  `pushState` cancels pending traversals that a real browser does not, so anything that changes *when*
  a traversal is issued relative to a push needs to be re-checked against a real browser — a static
  HTML page driven by Playwright is enough, no framework or dev server required.
- Do not use `setTimeout(0)` as a way to "beat" a pending traversal in general. It runs far too soon
  to matter against a real traversal's latency; only a delay well past that latency does.
- If a test that fakes `popstate` (dispatching a `PopStateEvent` by hand, or driving jsdom's own fast
  traversal) disagrees with the browser about timing, believe the browser: jsdom's cancellation
  behavior is the outlier here, not Chromium's asynchrony.
