import { describe, expect, it } from 'vitest'

import { makeStubExecutor } from './executor'
import { makeFakeExecutor } from './testing/fake-executor'

describe('fake executor', () => {
  it('acquires a context carrying the abort signal', async () => {
    const { executor, state } = makeFakeExecutor()
    const controller = new AbortController()
    const context = await executor.acquire(controller.signal)
    if (context instanceof Error) throw context
    expect(context.signal).toBe(controller.signal)
    expect(state.acquired).toBe(1)
    expect(state.lastSignal).toBe(controller.signal)
  })

  it('counts release and shutdown calls', async () => {
    const { executor, state } = makeFakeExecutor()
    const context = await executor.acquire(new AbortController().signal)
    if (context instanceof Error) throw context
    await executor.release(context)
    await executor.shutdown()
    expect(state.released).toBe(1)
    expect(state.shutdowns).toBe(1)
  })

  it('returns the configured acquire error', async () => {
    const { executor, state } = makeFakeExecutor()
    state.acquireError = new Error('no browser')
    const context = await executor.acquire(new AbortController().signal)
    expect(context).toBeInstanceOf(Error)
  })
})

describe('stub executor', () => {
  it('acquires, releases, and shuts down without throwing', async () => {
    const executor = makeStubExecutor()
    const context = await executor.acquire(new AbortController().signal)
    if (context instanceof Error) throw context
    await executor.release(context)
    await executor.shutdown()
    expect(context).toBeDefined()
  })
})
