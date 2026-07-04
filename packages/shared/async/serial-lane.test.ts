import { describe, expect, it } from 'vitest'

import { makeKeyedSerialLane, makeSerialLane } from './serial-lane'

describe('makeSerialLane', () => {
  it('runs tasks one at a time in FIFO order', async () => {
    const lane = makeSerialLane()
    const order: string[] = []
    const first = Promise.withResolvers<void>()

    const a = lane.run(async () => {
      order.push('a-start')
      await first.promise
      order.push('a-end')
      return 'a'
    })
    const b = lane.run(async () => {
      order.push('b')
      return 'b'
    })

    await Promise.resolve()
    expect(order).toEqual(['a-start'])
    first.resolve()
    expect(await a).toBe('a')
    expect(await b).toBe('b')
    expect(order).toEqual(['a-start', 'a-end', 'b'])
  })

  it('does not let a rejecting task block the next one', async () => {
    const lane = makeSerialLane()
    const failed = lane.run(async () => {
      throw new Error('boom')
    })
    await expect(failed).rejects.toThrow('boom')
    expect(await lane.run(async () => 'ok')).toBe('ok')
  })

  it('resolves whenIdle after queued tasks settle', async () => {
    const lane = makeSerialLane()
    const gate = Promise.withResolvers<void>()
    let done = false
    void lane.run(async () => {
      await gate.promise
      done = true
    })
    const idle = lane.whenIdle().then(() => done)
    gate.resolve()
    expect(await idle).toBe(true)
  })
})

describe('makeKeyedSerialLane', () => {
  it('serializes tasks for the same key', async () => {
    const lane = makeKeyedSerialLane()
    const order: string[] = []
    const first = Promise.withResolvers<void>()

    const a = lane.run('k', async () => {
      order.push('a-start')
      await first.promise
      order.push('a-end')
    })
    const b = lane.run('k', async () => {
      order.push('b')
    })

    await Promise.resolve()
    expect(order).toEqual(['a-start'])
    first.resolve()
    await Promise.all([a, b])
    expect(order).toEqual(['a-start', 'a-end', 'b'])
  })

  it('runs different keys concurrently', async () => {
    const lane = makeKeyedSerialLane()
    const order: string[] = []
    const blocker = Promise.withResolvers<void>()

    const a = lane.run('a', async () => {
      order.push('a-start')
      await blocker.promise
    })
    await lane.run('b', async () => {
      order.push('b')
    })

    expect(order).toEqual(['a-start', 'b'])
    blocker.resolve()
    await a
  })

  it('does not let a rejecting task block the same key', async () => {
    const lane = makeKeyedSerialLane()
    await expect(
      lane.run('k', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await lane.run('k', async () => 'ok')).toBe('ok')
  })
})
