import { context } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TimeError } from './http-time'
import { createServerTime, getServerTime } from './server-time'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  context.reset()
})

describe('createServerTime', () => {
  it('is null before the first sync', () => {
    const timer = createServerTime(async () => 0)

    expect(timer.nowMs()).toBeNull()
    expect(timer.today('Europe/Warsaw')).toBeNull()
    expect(timer.isSynced()).toBe(false)
  })

  it('computes the offset and resolves today after sync', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-21T00:00:00.000Z'))
    const serverNow = Date.parse('2026-06-22T09:00:00.000Z')
    const timer = createServerTime(async () => serverNow)

    await timer.sync()

    expect(timer.nowMs()).toBe(serverNow)
    expect(timer.today('Europe/Warsaw')?.toString()).toBe('2026-06-22')
    expect(timer.isSynced()).toBe(true)
  })

  it('keeps the offset null and surfaces the error when the fetch fails', async () => {
    const timer = createServerTime(async () => new TimeError({ reason: 'boom' }))

    await expect(timer.sync()).rejects.toBeInstanceOf(TimeError)

    expect(timer.nowMs()).toBeNull()
    expect(timer.isSynced()).toBe(false)
  })

  it('re-syncs when the tab becomes visible', async () => {
    const fetchTime = vi.fn(async () => 1_700_000_000_000)
    const timer = createServerTime(fetchTime)

    // Subscribing to a computed that reads offsetMs activates the connect hook
    // (initial sync + visibilitychange listener).
    const unsubscribe = timer.isSynced.subscribe(() => {})
    await vi.waitFor(() => expect(fetchTime).toHaveBeenCalledTimes(1))

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    await vi.waitFor(() => expect(fetchTime).toHaveBeenCalledTimes(2))
    unsubscribe()
  })
})

describe('getServerTime', () => {
  it('returns the same singleton instance', () => {
    expect(getServerTime()).toBe(getServerTime())
  })
})
