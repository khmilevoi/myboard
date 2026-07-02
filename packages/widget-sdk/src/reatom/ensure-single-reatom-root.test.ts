import { atom, context, STACK } from '@reatom/core'
import { afterEach, describe, expect, it } from 'vitest'

import { ensureSingleReatomRoot } from './ensure-single-reatom-root'

afterEach(() => {
  // Repair the shared stack whatever a test did to it, then reset state.
  ensureSingleReatomRoot()
  context.reset()
})

describe('ensureSingleReatomRoot', () => {
  it('collapses import-time roots of duplicate @reatom/core copies onto the oldest root', () => {
    const counter = atom(0, 'test.counter')
    counter.set(7) // state lives in the current (oldest) root

    // Simulate what importing a second copy of @reatom/core does:
    // its module side effect pushes a fresh root onto the SHARED
    // globalThis.__REATOM.stackFrames (see `STACK.push(context.start())`
    // in @reatom/core), burying the root that owns all existing state.
    STACK.push(context.start())
    expect(counter()).toBe(0) // split brain: the new root hides the state

    ensureSingleReatomRoot()

    expect(STACK.length).toBe(1)
    expect(counter()).toBe(7) // the original root is active again
  })

  it('is a no-op on a healthy single-root stack', () => {
    const counter = atom(1, 'test.single')
    counter.set(2)
    const before = STACK.length

    ensureSingleReatomRoot()

    expect(STACK.length).toBe(before)
    expect(counter()).toBe(2)
  })

  it('does not touch non-root work frames', () => {
    // Inside atom computation the stack top is a regular frame, not a root.
    const probe = atom(() => {
      ensureSingleReatomRoot()
      return STACK.length
    }, 'test.insideComputation')

    expect(probe()).toBeGreaterThan(1)
  })
})
