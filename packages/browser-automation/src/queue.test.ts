import { describe, expect, it } from 'vitest'

import { AutomationTimeoutError } from './errors'
import { makeSingleLaneQueue } from './queue'

describe('makeSingleLaneQueue', () => {
  it('runs jobs one at a time in FIFO order', async () => {
    const queue = makeSingleLaneQueue({ queueWaitMs: 1000, executionMs: 1000 })
    const order: string[] = []
    const first = Promise.withResolvers<void>()

    const p1 = queue.enqueue(async () => {
      order.push('start-1')
      await first.promise
      order.push('end-1')
      return 1
    })
    const p2 = queue.enqueue(async () => {
      order.push('start-2')
      return 2
    })

    await Promise.resolve()
    expect(order).toEqual(['start-1']) // second has not started while first runs
    first.resolve()
    expect(await p1).toBe(1)
    expect(await p2).toBe(2)
    expect(order).toEqual(['start-1', 'end-1', 'start-2'])
  })

  it('times out a job that waits too long in the queue', async () => {
    const queue = makeSingleLaneQueue({ queueWaitMs: 20, executionMs: 1000 })
    const blocker = Promise.withResolvers<void>()
    const p1 = queue.enqueue(async () => {
      await blocker.promise
      return 1
    })
    const p2 = queue.enqueue(async () => 2)

    const r2 = await p2
    expect(r2).toBeInstanceOf(AutomationTimeoutError)
    expect((r2 as AutomationTimeoutError).phase).toBe('queue')
    blocker.resolve()
    await p1
  })

  it('times out and aborts a running job, then frees the lane', async () => {
    const queue = makeSingleLaneQueue({ queueWaitMs: 1000, executionMs: 20 })
    let aborted = false
    const order: string[] = []

    const p1 = queue.enqueue(
      (signal) =>
        new Promise((resolve) => {
          order.push('start-1')
          signal.addEventListener('abort', () => {
            aborted = true
            order.push('abort-1')
            resolve('cleaned-up')
          })
        }),
    )
    const p2 = queue.enqueue(async () => {
      order.push('start-2')
      return 2
    })

    const r1 = await p1
    expect(r1).toBeInstanceOf(AutomationTimeoutError)
    expect((r1 as AutomationTimeoutError).phase).toBe('execution')
    expect(aborted).toBe(true)
    expect(await p2).toBe(2)
    expect(order).toEqual(['start-1', 'abort-1', 'start-2']) // next starts only after teardown
  })

  it('rejects queued and new jobs after close', async () => {
    const queue = makeSingleLaneQueue({ queueWaitMs: 1000, executionMs: 1000 })
    const blocker = Promise.withResolvers<void>()
    const p1 = queue.enqueue(async () => {
      await blocker.promise
      return 1
    })
    const p2 = queue.enqueue(async () => 2)

    queue.close(() => new Error('unavailable'))
    const p3 = queue.enqueue(async () => 3)

    expect(await p3).toBeInstanceOf(Error) // new enqueue after close
    blocker.resolve()
    await p1
    expect(await p2).toBeInstanceOf(Error) // queued-but-not-started rejected
    await queue.whenSettled()
  })
})
