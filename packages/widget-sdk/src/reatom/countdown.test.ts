import { atom, context } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatCountdown, makeCountdown, makeTickingNow } from './countdown'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  context.reset()
})

describe('makeTickingNow', () => {
  it('ticks only while subscribed', async () => {
    let time = 1_000
    const now = makeTickingNow({ now: () => time, intervalMs: 1000, name: 'test.now' })
    expect(vi.getTimerCount()).toBe(0)

    const values: number[] = []
    const unsubscribe = now.subscribe((value) => values.push(value))
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(1)

    time = 2_000
    await vi.advanceTimersByTimeAsync(1000)
    expect(now()).toBe(2_000)
    expect(values.at(-1)).toBe(2_000)

    unsubscribe()
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('formatCountdown', () => {
  it('formats minutes and seconds, clamps at zero, rounds seconds up', () => {
    expect(formatCountdown(292_000)).toBe('4:52')
    expect(formatCountdown(-5)).toBe('0:00')
    expect(formatCountdown(1)).toBe('0:01')
  })
})

describe('makeCountdown', () => {
  it('expires when the clock passes expiresAt', () => {
    const clock = atom(1_000, 'test.clock')
    const expiresAt = atom<number | null>(61_000, 'test.expiresAt')
    const countdown = makeCountdown({ expiresAt, clock, name: 'test.countdown' })

    expect(countdown.remainingMs()).toBe(60_000)
    expect(countdown.label()).toBe('1:00')
    expect(countdown.expired()).toBe(false)

    clock.set(61_000)
    expect(countdown.remainingMs()).toBe(0)
    expect(countdown.label()).toBe('0:00')
    expect(countdown.expired()).toBe(true)
  })

  it('treats a null expiresAt as not expired and labels it 0:00', () => {
    const clock = atom(1_000, 'test.clock')
    const expiresAt = atom<number | null>(null, 'test.expiresAt')
    const countdown = makeCountdown({ expiresAt, clock, name: 'test.countdown' })

    expect(countdown.expired()).toBe(false)
    expect(countdown.label()).toBe('0:00')
    expect(countdown.remainingMs()).toBe(0)
  })
})
