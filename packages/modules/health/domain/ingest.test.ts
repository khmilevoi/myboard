import type { WidgetServerStorage } from '@shared/widgets/contracts'
import { describe, expect, it } from 'vitest'

import { ingestMeasurement } from './ingest'
import { latestKey, monthKey } from './keys'
import type { Measurement } from './measurement'

function fakeStorage() {
  const data = new Map<string, unknown>()
  const storage: WidgetServerStorage = {
    get: async (key) => (data.get(key) as never) ?? null,
    set: async (key, value) => void data.set(key, value),
    delete: async (key) => void data.delete(key),
    has: async (key) => data.has(key),
    keys: async (prefix = '') => [...data.keys()].filter((k) => k.startsWith(prefix)),
    append: async (key, entry) => {
      const list = (data.get(key) as unknown[] | undefined) ?? []
      data.set(key, [...list, entry])
    },
  }
  return { data, storage }
}

const source = { kind: 'hardware', hardwareId: 'h', model: 'm' } as const
const T = Date.UTC(2026, 10, 10)
const reading = (id: string, takenAt: number, metrics: Measurement['metrics']): Measurement => ({
  id,
  takenAt,
  metrics,
  source,
})
const kg = (value: number) => ({ weight: { value, unit: 'kg' } })

describe('ingestMeasurement', () => {
  it('appends to the month ledger and sets latest for every kind', async () => {
    const { data, storage } = fakeStorage()
    const m = reading('a', T, { ...kg(70), 'body-fat': { value: 20, unit: '%' } })

    expect(await ingestMeasurement(storage, m)).toEqual({ stored: true })
    expect(data.get(monthKey(T))).toEqual([m])
    expect(data.get(latestKey('weight'))).toEqual(m)
    expect(data.get(latestKey('body-fat'))).toEqual(m)
  })

  it('is idempotent on id', async () => {
    const { data, storage } = fakeStorage()
    const m = reading('a', T, kg(70))
    await ingestMeasurement(storage, m)

    expect(await ingestMeasurement(storage, m)).toEqual({ stored: false })
    expect(data.get(monthKey(T))).toHaveLength(1)
  })

  it('keeps the newer latest when an older reading arrives late', async () => {
    const { data, storage } = fakeStorage()
    const newer = reading('n', T + 1000, kg(71))
    const older = reading('o', T, kg(70))
    await ingestMeasurement(storage, newer)

    expect(await ingestMeasurement(storage, older)).toEqual({ stored: true })
    expect(data.get(monthKey(T))).toHaveLength(2)
    expect(data.get(latestKey('weight'))).toEqual(newer)
  })

  it('leaves latest weight alone for a body-composition-only reading', async () => {
    const { data, storage } = fakeStorage()
    const w = reading('w', T, kg(70))
    const fat = reading('f', T + 1000, { 'body-fat': { value: 21, unit: '%' } })
    await ingestMeasurement(storage, w)
    await ingestMeasurement(storage, fat)

    expect(data.get(latestKey('weight'))).toEqual(w)
    expect(data.get(latestKey('body-fat'))).toEqual(fat)
  })

  it('heals latest on a retry after the first latest write failed', async () => {
    const { data, storage } = fakeStorage()
    const boom = new Error('boom')
    let failNextSet = true
    const flaky: WidgetServerStorage = {
      ...storage,
      set: async (key, value) => {
        if (failNextSet) {
          failNextSet = false
          return boom
        }
        return storage.set(key, value)
      },
    }
    const m = reading('a', T, kg(70))

    expect(await ingestMeasurement(flaky, m)).toBe(boom)
    expect(data.get(latestKey('weight'))).toBeUndefined()

    expect(await ingestMeasurement(flaky, m)).toEqual({ stored: false })
    expect(data.get(monthKey(T))).toHaveLength(1)
    expect(data.get(latestKey('weight'))).toEqual(m)
  })

  it('leaves latest unchanged for a reading with an equal takenAt', async () => {
    const { data, storage } = fakeStorage()
    const first = reading('a', T, kg(70))
    await ingestMeasurement(storage, first)
    await ingestMeasurement(storage, reading('b', T, kg(71)))

    expect(data.get(latestKey('weight'))).toEqual(first)
  })

  it('returns storage errors as values', async () => {
    const { storage } = fakeStorage()
    const boom = new Error('boom')
    const failing = { ...storage, get: async () => boom } as WidgetServerStorage
    expect(await ingestMeasurement(failing, reading('a', T, kg(70)))).toBe(boom)
  })
})
