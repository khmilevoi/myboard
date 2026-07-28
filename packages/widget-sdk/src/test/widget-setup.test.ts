import { pushOverlay } from 'widget-runtime'

// `widget-setup.ts` (this directory's sibling, wired as this package's own
// `setupFiles` entry and, through `defineWidgetVitestConfig`, every widget
// package's) registers a `beforeEach` that resets `overlay-history.ts`'s
// file-scoped singletons. This file has NO reset of its own — that is the
// point: if the shared setup's `beforeEach` did not run, or ran but did
// nothing, the second test below would see the first test's still-open entry
// and land on depth 2 instead of 1. A reset nobody can observe is
// indistinguishable from no reset, so this pins the shared hook's effect
// directly rather than trusting that some other file's tests merely stayed
// green.
describe('the shared widget test setup resets overlay-history between tests', () => {
  it('leaks an overlay entry on purpose — never dropped, never popped', () => {
    const entry = pushOverlay(() => {})
    expect(entry.depth).toBe(1)
    expect(history.state).toEqual({ overlayDepth: 1 })
    // No dropOverlay call. Without the shared beforeEach, this entry and its
    // history.state stamp would still be live when the next test starts.
  })

  it('starts clean: the previous test never leaked its entry here', () => {
    // If widget-setup.ts's beforeEach had not run (or had been removed),
    // `history.state` would still read `{ overlayDepth: 1 }` from the test
    // above, and this push would claim depth 2, not 1.
    expect(history.state).toEqual({})
    const entry = pushOverlay(() => {})
    expect(entry.depth).toBe(1)
    expect(history.state).toEqual({ overlayDepth: 1 })
  })
})
