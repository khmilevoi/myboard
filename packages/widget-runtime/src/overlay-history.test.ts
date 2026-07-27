// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  dismissOverlay,
  dropOverlay,
  pushOverlay,
  resetOverlayHistory,
} from './overlay-history'

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

  it('gives the history entry back when an overlay closes outside the history flow', () => {
    const close = vi.fn()
    const entry = pushOverlay(close)
    const go = vi.spyOn(history, 'go').mockImplementation(() => undefined)

    dropOverlay(entry)
    expect(go).toHaveBeenCalledOnce()
    expect(go).toHaveBeenCalledWith(-1)
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

  it('closes the upper overlay when dropping a lower one', () => {
    const first = vi.fn()
    const second = vi.fn()
    const e1 = pushOverlay(first)
    const e2 = pushOverlay(second)

    // Stack is [e1, e2]; dropping e1 requires going back 2 steps to remove both
    const go = vi.spyOn(history, 'go').mockImplementation(() => undefined)

    dropOverlay(e1)

    expect(go).toHaveBeenCalledWith(-2)
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

describe('overlay history — real history traversal', () => {
  it('closes the overlay when history.back() is called for real', async () => {
    const close = vi.fn()
    const entry = pushOverlay(close)

    dismissOverlay(entry)

    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce())
  })
})
