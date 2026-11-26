import { atom, context, wrap } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModuleApiError } from 'widget-runtime'

import { latestKey } from '../domain/keys'
import type { Measurement } from '../domain/measurement'
import { makeTestHealthModel } from './testing'

const D = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 8)

function reading(id: string, takenAt: number, kg?: number, fat?: number): Measurement {
  const metrics: Measurement['metrics'] = {}
  if (kg !== undefined) metrics.weight = { value: kg, unit: 'kg' }
  if (fat !== undefined) metrics['body-fat'] = { value: fat, unit: '%' }
  return { id, takenAt, metrics, source: { kind: 'hardware', hardwareId: 'h', model: 'm' } }
}

afterEach(() => {
  context.reset()
})

describe('health model latest', () => {
  it('reflects the seeded latest and follows later changes of the key', async () => {
    const { model, storage, ready } = makeTestHealthModel({
      measurements: [reading('a', D(2026, 5, 1), 80)],
    })
    await ready

    await context.start(async () => {
      const latest = model.latest('weight')
      const off = latest.subscribe(() => {})
      const read = wrap(() => latest())
      await vi.waitFor(() => expect(read()?.id).toBe('a'))

      const newer = reading('b', D(2026, 5, 2), 79)
      await storage.set(latestKey('weight'), newer)
      await vi.waitFor(() => expect(read()).toEqual(newer))

      off()
    })
  })

  it('is memoized per kind', () => {
    const { model } = makeTestHealthModel()
    expect(model.latest('weight')).toBe(model.latest('weight'))
    expect(model.latest('weight')).not.toBe(model.latest('bmi'))
  })

  it('stays null for a kind that was never measured', async () => {
    const { model, ready } = makeTestHealthModel({
      measurements: [reading('a', D(2026, 5, 1), 80)],
    })
    await ready
    await context.start(async () => {
      const latest = model.latest('body-fat')
      const off = latest.subscribe(() => {})
      await Promise.resolve()
      expect(wrap(() => latest())()).toBeNull()
      off()
    })
  })
})

describe('health model series', () => {
  const MEASUREMENTS = [
    reading('w2', D(2026, 6, 3), 79),
    reading('w1', D(2026, 5, 30), 80),
    reading('w1', D(2026, 5, 30), 80), // same id ingested twice
    reading('fat-only', D(2026, 6, 1), undefined, 20),
    reading('w0', D(2026, 5, 1), 81), // before the range
  ]

  it('merges months, sorts, ignores other kinds and drops duplicate ids', async () => {
    const { model, storage, ready } = makeTestHealthModel({ measurements: MEASUREMENTS })
    await ready
    // Read-side dedupe: force a raw duplicate into the ledger, bypassing ingest.
    await storage.append('measurements/2026-05', reading('w1', D(2026, 5, 30), 80))

    const range = atom({ from: D(2026, 5, 15), to: D(2026, 6, 15) }, 'test.range')
    const series = model.series('weight', range)

    await context.start(async () => {
      const off = series.subscribe(() => {})
      const read = wrap(() => series())
      await vi.waitFor(() => expect(read()).not.toBeNull())
      expect(read()!.map((m) => m.id)).toEqual(['w1', 'w2'])
      off()
    })
  })

  it('is null until the months load', () => {
    const { model } = makeTestHealthModel()
    const range = atom({ from: D(2026, 5, 15), to: D(2026, 6, 15) }, 'test.range')
    expect(model.series('weight', range)()).toBeNull()
  })

  it('treats a month with no ledger as empty, not as loading, when the range moves', async () => {
    const { model, ready } = makeTestHealthModel({ measurements: MEASUREMENTS })
    await ready
    const range = atom({ from: D(2026, 5, 15), to: D(2026, 6, 15) }, 'test.range')
    const series = model.series('weight', range)

    await context.start(async () => {
      const off = series.subscribe(() => {})
      const read = wrap(() => series())
      const setRange = wrap((next: { from: number; to: number }) => range.set(next))
      await vi.waitFor(() => expect(read()).toHaveLength(2))

      setRange({ from: D(2025, 1, 1), to: D(2025, 1, 31) })
      await vi.waitFor(() => expect(read()).toEqual([]))
      off()
    })
  })

  it('clips to [from, to] inclusive', async () => {
    const { model, ready } = makeTestHealthModel({ measurements: MEASUREMENTS })
    await ready
    const range = atom({ from: D(2026, 5, 30), to: D(2026, 6, 3) }, 'test.range')
    const series = model.series('weight', range)

    await context.start(async () => {
      const off = series.subscribe(() => {})
      const read = wrap(() => series())
      await vi.waitFor(() => expect(read()?.map((m) => m.id)).toEqual(['w1', 'w2']))
      off()
    })
  })
})

describe('health model profile', () => {
  const PROFILE = { heightCm: 180, birthDate: '1990-01-01', sex: 'male' as const }

  it('loads the stored profile', async () => {
    const { model } = makeTestHealthModel({ profile: PROFILE })
    await context.start(async () => {
      const off = model.profile.subscribe(() => {})
      const read = wrap(() => model.profile())
      await vi.waitFor(() => expect(read()).toEqual(PROFILE))
      off()
    })
  })

  it('setProfile invokes the setProfile action', async () => {
    const { model, calls } = makeTestHealthModel()
    const result = await context.start(() => wrap(() => model.setProfile(PROFILE))())
    expect(result).toBeUndefined()
    expect(calls).toEqual([{ action: 'setProfile', payload: PROFILE }])
  })

  it('returns an API failure as a value', async () => {
    const failure = new ModuleApiError({ code: 'payload_invalid', reason: 'bad' } as never)
    const { model } = makeTestHealthModel({ invoke: async () => failure })
    const result = await context.start(() => wrap(() => model.setProfile(PROFILE))())
    expect(result).toBe(failure)
  })
})
