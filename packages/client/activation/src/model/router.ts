import { atom, wrap } from '@reatom/core'

// Reactive location for the standalone activation SPA. `/activate` and
// `/add-device` are the same bundle (nginx serves both from
// /activate/index.html), so in-app moves between them can be client-side
// pushState transitions instead of full reloads. Navigation to `/` after a
// successful login/activation stays a hard load (that is the board bundle) and
// is NOT routed here -- see each model's `navigate` dep.

function currentPathname(): string {
  return typeof location === 'undefined' ? '/activate' : location.pathname
}

function currentSearch(): string {
  return typeof location === 'undefined' ? '' : location.search
}

export const pathname = atom(currentPathname(), 'activation.router.pathname')
export const search = atom(currentSearch(), 'activation.router.search')

function syncNow(): void {
  pathname.set(currentPathname())
  search.set(currentSearch())
}

// Deferred/event-driven writes run through `wrap` so they keep the reatom
// context, matching the `wrap`ped interval/timer callbacks elsewhere in this
// app (e.g. `clock-model.ts`). `wrap` is called fresh at each call site
// (not hoisted to a module-level closure) because `context.reset()` -- used
// between tests, and equivalent to a hard app reset -- permanently aborts
// any previously-created `wrap()` closure. A closure created once at import
// time would work for the first caller and then throw `AbortError` forever
// after the first reset.
export function navigateInApp(path: string): void {
  if (typeof history !== 'undefined') history.pushState(null, '', path)
  wrap(syncNow)()
}

let initialized = false

export function initRouter(): void {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  window.addEventListener('popstate', () => wrap(syncNow)())
}
