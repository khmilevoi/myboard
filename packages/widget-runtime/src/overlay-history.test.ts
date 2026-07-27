// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { dismissOverlay, dropOverlay, pushOverlay, resetOverlayHistory } from './overlay-history'

// The module reconciles against `history.state`, so a simulated back
// navigation must move the state first and then raise the event, exactly as a
// real traversal does. This keeps the unit tests independent of whether jsdom
// implements `history.back()` — one integration test at the bottom covers that
// separately.
function goBackTo(depth: number) {
  history.replaceState({ overlayDepth: depth }, '')
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
}

beforeEach(() => {
  // Several cases spy on `history.go`/`history.back` and restore inside the
  // test body, so a failing assertion would otherwise leak the spy — and its
  // recorded calls — into the next case.
  vi.restoreAllMocks()
  resetOverlayHistory()
  history.replaceState({}, '')
})

describe('overlay history', () => {
  it('marks a history entry with the depth of the overlay it belongs to', () => {
    pushOverlay(vi.fn())
    expect(history.state).toEqual({ overlayDepth: 1 })

    pushOverlay(vi.fn())
    expect(history.state).toEqual({ overlayDepth: 2 })
  })

  it('closes every overlay deeper than the entry the user landed on', () => {
    const first = vi.fn()
    const second = vi.fn()
    pushOverlay(first)
    pushOverlay(second)

    goBackTo(1)
    expect(second).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()

    goBackTo(0)
    expect(first).toHaveBeenCalledOnce()
  })

  it('closes both overlays when the user goes back past two entries at once', () => {
    const first = vi.fn()
    const second = vi.fn()
    pushOverlay(first)
    pushOverlay(second)

    goBackTo(0)
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
  })

  it('closes nothing a second time when popstate arrives again at the same depth', () => {
    const close = vi.fn()
    pushOverlay(close)

    goBackTo(0)
    goBackTo(0)
    expect(close).toHaveBeenCalledOnce()
  })

  it('ignores a dismiss for an entry that is no longer registered', () => {
    const close = vi.fn()
    const entry = pushOverlay(close)
    goBackTo(0)
    close.mockClear()

    dismissOverlay(entry)
    expect(close).not.toHaveBeenCalled()
  })

  it('gives the history entry back when an overlay closes outside the history flow', async () => {
    const close = vi.fn()
    const entry = pushOverlay(close)
    const go = vi.spyOn(history, 'go').mockImplementation(() => undefined)

    dropOverlay(entry)
    // Deferred, not performed: a push in this same task is allowed to claim
    // the entry instead. Nothing does here, so the flush traverses.
    expect(go).not.toHaveBeenCalled()

    await vi.waitFor(() => expect(go).toHaveBeenCalledWith(-1))
    expect(go).toHaveBeenCalledOnce()
    expect(close).not.toHaveBeenCalled()

    go.mockRestore()
  })

  it('does not spend a second history entry when the drop follows a user back', () => {
    const close = vi.fn()
    const entry = pushOverlay(close)

    // The user pressed back: popstate already closed and unregistered the
    // overlay. React then unmounts it and the effect cleanup calls dropOverlay
    // on an entry that is gone. This must be a no-op — the guard that keeps the
    // normal path from consuming an extra history entry.
    goBackTo(0)
    const go = vi.spyOn(history, 'go').mockImplementation(() => undefined)

    dropOverlay(entry)
    expect(go).not.toHaveBeenCalled()

    go.mockRestore()
  })

  it('clears a stale depth left in history by a reload', () => {
    history.replaceState({ overlayDepth: 3 }, '')

    pushOverlay(vi.fn())
    expect(history.state).toEqual({ overlayDepth: 1 })
  })

  it('closes the upper overlay when dropping a lower one', async () => {
    const first = vi.fn()
    const second = vi.fn()
    const e1 = pushOverlay(first)
    pushOverlay(second)

    // Stack is [e1, e2]; dropping e1 requires going back 2 steps to remove both
    const go = vi.spyOn(history, 'go').mockImplementation(() => undefined)

    dropOverlay(e1)

    await vi.waitFor(() => expect(go).toHaveBeenCalledWith(-2))
    go.mockRestore()

    // dropOverlay splices e1 locally, so first should not be called again.
    // Simulate the popstate that results from history.go(-2): we land on depth 0.
    // reconcile() closes everything deeper than depth 0, which is e2.
    goBackTo(0)
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()

    // Stack is now empty; next push gets depth 1
    const third = vi.fn()
    const e3 = pushOverlay(third)
    expect(e3.depth).toBe(1)
  })
})

// These drive real navigation — `history.back()`, and the traversal the module
// schedules itself — and assert on the settled state afterwards. Faking a
// popstate cannot distinguish a coalesced drop-then-push from two entries that
// merely happen to carry the same depth; a real back press can, because it
// lands on a different entry in each case.
describe('overlay history — real history traversal', () => {
  // jsdom keeps one session history for the whole file, so each of these owns
  // the entry a back press is supposed to land on rather than inheriting
  // whatever the previous test left current. It is marked so that landing on
  // it is distinguishable from overshooting past it — `beforeEach` leaves the
  // current entry `{}`, so an unmarked baseline would match either.
  const baseline = { marker: 'baseline' }
  const pushBaseline = (): void => {
    history.pushState(baseline, '')
  }

  // One flush task plus jsdom's two-task traversal, with slack.
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50))

  it('closes the overlay when history.back() is called for real', async () => {
    const close = vi.fn()
    const entry = pushOverlay(close)

    dismissOverlay(entry)

    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
  })

  it('still traverses for a drop that no push follows', async () => {
    pushBaseline()
    const close = vi.fn()
    const entry = pushOverlay(close)
    expect(history.state).toEqual({ ...baseline, overlayDepth: 1 })

    dropOverlay(entry)

    // The marker is what makes this an assertion about landing on the baseline
    // rather than merely about leaving the overlay entry.
    await vi.waitFor(() => expect(history.state).toEqual(baseline))
    expect(close).not.toHaveBeenCalled()
  })

  it('reuses the owed entry when a push follows a drop in the same task', async () => {
    pushBaseline()
    const dropped = vi.fn()
    const opened = vi.fn()

    // push → drop → push, exactly what StrictMode's mount → cleanup → mount
    // produces, and what a state change that closes one overlay and opens
    // another produces in a single commit.
    const entry = pushOverlay(dropped)
    dropOverlay(entry)
    pushOverlay(opened)

    await settle()

    // No traversal ran, so no spontaneous popstate closed the overlay that had
    // just opened, and only one entry was spent. Both are "nothing happened"
    // assertions, so the fixed settle is the point rather than a race.
    expect(opened).not.toHaveBeenCalled()
    expect(history.state).toEqual({ ...baseline, overlayDepth: 1 })

    history.back()

    await vi.waitFor(() => expect(opened).toHaveBeenCalledOnce())
    expect(history.state).toEqual(baseline)
    expect(dropped).not.toHaveBeenCalled()
  })

  it('takes the freed depth from the debt when the drop was not the topmost entry', async () => {
    pushBaseline()
    const lower = vi.fn()
    const upper = vi.fn()
    const opened = vi.fn()

    const lowerEntry = pushOverlay(lower)
    pushOverlay(upper)

    dropOverlay(lowerEntry)
    const openedEntry = pushOverlay(opened)

    // `stack.length + 1` would be 2 here — the depth the overlay above the
    // drop still holds while it waits to be closed. Taking it from the debt
    // instead keeps the two depths distinct.
    expect(openedEntry.depth).toBe(1)

    // The push consumed one of the two owed entries; the flush traverses the
    // rest, and reconciliation closes the overlay that sat above the drop.
    await vi.waitFor(() => expect(upper).toHaveBeenCalledOnce())
    expect(lower).not.toHaveBeenCalled()
    expect(opened).not.toHaveBeenCalled()
    expect(history.state).toEqual({ ...baseline, overlayDepth: 1 })

    history.back()

    await vi.waitFor(() => expect(opened).toHaveBeenCalledOnce())
    expect(history.state).toEqual(baseline)
  })

  it('coalesces two drops in the same task into a single traversal a push can claim', async () => {
    pushBaseline()
    const first = vi.fn()
    const second = vi.fn()
    const third = vi.fn()

    const e1 = pushOverlay(first)
    const e2 = pushOverlay(second)

    dropOverlay(e1)
    dropOverlay(e2)
    const e3 = pushOverlay(third)

    expect(e3.depth).toBe(1)

    // A positive assertion — it needs the single go(-1) to have completed —
    // so it waits for the traversal rather than assuming a fixed delay.
    await vi.waitFor(() => expect(history.state).toEqual({ ...baseline, overlayDepth: 1 }))
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    expect(third).not.toHaveBeenCalled()

    history.back()

    await vi.waitFor(() => expect(third).toHaveBeenCalledOnce())
    expect(history.state).toEqual(baseline)
  })

  it('keeps depth contiguous when an ordinary push follows a duplicate-depth stack', async () => {
    pushBaseline()
    const lower = vi.fn()
    const stale = vi.fn()
    const first = vi.fn()
    const second = vi.fn()
    const third = vi.fn()

    // Build the one state where the stack holds two entries at the same depth:
    // a mid-stack drop whose debt is then consumed entirely by two pushes, so
    // no traversal ever runs and `stale` is left waiting above them.
    const lowerEntry = pushOverlay(lower)
    pushOverlay(stale)
    dropOverlay(lowerEntry)
    pushOverlay(first)
    const secondEntry = pushOverlay(second)

    await settle()
    // Stack is [first(1), second(2), stale(2)] against two real entries.
    expect(history.state).toEqual({ ...baseline, overlayDepth: 2 })
    expect(stale).not.toHaveBeenCalled()

    // `stack.length + 1` would stamp 4 on an entry that history places
    // immediately after the depth-2 one. Depth would stop counting entries.
    const thirdEntry = pushOverlay(third)
    expect(thirdEntry.depth).toBe(3)

    // And that miscount is what a later drop pays for: dropping `second` must
    // walk back to depth 1, which is two entries, not three. Under
    // `stack.length + 1` it goes back three and takes `first` with it.
    dropOverlay(secondEntry)

    await vi.waitFor(() => expect(third).toHaveBeenCalledOnce())
    expect(stale).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()
    expect(history.state).toEqual({ ...baseline, overlayDepth: 1 })
  })

  it('clears a pending traversal on reset instead of firing it into the next test', async () => {
    history.pushState({ marker: 'before' }, '')
    history.pushState({ marker: 'after' }, '')

    const entry = pushOverlay(vi.fn())
    dropOverlay(entry)

    resetOverlayHistory()

    await settle()

    // Still standing on the overlay's own entry: the scheduled flush was
    // cancelled rather than left to navigate whatever runs next.
    expect(history.state).toEqual({ marker: 'after', overlayDepth: 1 })
  })
})
