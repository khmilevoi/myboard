import { context } from '@reatom/core'
import { afterEach, describe, expect, it } from 'vitest'
import { createFakeTimer } from './fakes'

afterEach(() => {
  context.reset()
})

describe('createFakeTimer', () => {
  it('reports unsynced and null today by default', () => {
    const timer = createFakeTimer()

    expect(timer.today('Europe/Warsaw')).toBeNull()
    expect(timer.nowMs()).toBeNull()
    expect(timer.isSynced()).toBe(false)
  })

  it('returns the provided today regardless of zone and reports synced', () => {
    const today = Temporal.PlainDate.from('2026-06-16')
    const timer = createFakeTimer({ today })

    expect(timer.today('Europe/Warsaw')).toBe(today)
    expect(timer.isSynced()).toBe(true)
  })

  it('resolves sync as a no-op', async () => {
    const timer = createFakeTimer({ today: Temporal.PlainDate.from('2026-06-16') })

    await expect(timer.sync()).resolves.toBeUndefined()
  })
})
