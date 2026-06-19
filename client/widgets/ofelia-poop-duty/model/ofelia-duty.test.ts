import { context } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StorageApi } from '../../../src/storage/model/types'
import type { WidgetStorage } from '../../../src/storage/model/widget-storage'
import { ofeliaDutyModel } from './ofelia-duty'

function createStorage(): WidgetStorage {
  const api: StorageApi = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    keys: vi.fn(async () => []),
    subscribe: vi.fn(() => () => {}),
  }

  return {
    instance: { client: api, server: api },
    shared: { client: api, server: api },
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-06-16T10:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
  context.reset()
})

describe('ofeliaDutyModel', () => {
  it('uses the current date when the week recomputes after midnight', () => {
    const model = ofeliaDutyModel({ storage: createStorage() })

    expect(model.currentWeek().find((day) => day.isToday)?.date.toString()).toBe('2026-06-16')

    vi.setSystemTime(new Date('2026-06-17T10:00:00.000Z'))
    model.numberOfDebts.value.set({ Леша: 0, Карина: 0 })

    expect(model.currentWeek().find((day) => day.isToday)?.date.toString()).toBe('2026-06-17')
  })
})
