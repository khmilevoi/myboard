import { context, wrap } from '@reatom/core'
import type { Measurement } from 'module-health/domain/measurement'
import { makeTestHealthModel } from 'module-health/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModuleLoadError, StorageError, type StorageApi, type WidgetModules } from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

import { makeWeightView } from './weight-view'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 26, 9)
const daysAgo = (days: number) => NOW - days * DAY

function reading(id: string, takenAt: number, kg?: number): Measurement {
  const metrics: Measurement['metrics'] =
    kg === undefined
      ? { 'body-fat': { value: 20, unit: '%' } }
      : { weight: { value: kg, unit: 'kg' } }
  return { id, takenAt, metrics, source: { kind: 'hardware', hardwareId: 'h', model: 'm' } }
}

const modulesOf = (model: unknown) => ({ get: async () => model }) as unknown as WidgetModules

async function makeView(measurements: Measurement[]) {
  const { model, ready } = makeTestHealthModel({ measurements })
  expect(await ready).toBeUndefined()
  return makeWeightView(modulesOf(model), () => NOW)
}

/** Subscribes to every member so the module loads and the key atoms connect. */
function connect(view: ReturnType<typeof makeWeightView>) {
  const offs = [
    view.state.subscribe(() => {}),
    view.latest.subscribe(() => {}),
    view.rows.subscribe(() => {}),
    view.compact.state.subscribe(() => {}),
  ]
  return () => offs.forEach((off) => off())
}

afterEach(() => {
  context.reset()
})

describe('makeWeightView', () => {
  it('is ready with two readings in the period, and the delta is newer minus older', async () => {
    const view = await makeView([reading('a', daysAgo(30), 84.4), reading('b', daysAgo(10), 83)])
    await context.start(async () => {
      const off = connect(view)
      const read = wrap(() => ({
        state: view.state(),
        delta: view.delta(),
        points: view.points(),
        latest: view.latest(),
        period: view.period(),
      }))
      await vi.waitFor(() => expect(read().state).toBe('ready'))
      expect(read().period).toBe('30d')
      expect(read().delta).toBeCloseTo(83 - 84.4)
      expect(read().points).toEqual([
        { takenAt: daysAgo(30), kg: 84.4 },
        { takenAt: daysAgo(10), kg: 83 },
      ])
      expect(read().latest?.id).toBe('b')
      off()
    })
  })

  it('widens the series when the period switches to a year', async () => {
    const view = await makeView([
      reading('old', daysAgo(200), 90),
      reading('a', daysAgo(20), 84),
      reading('b', daysAgo(5), 83),
    ])
    await context.start(async () => {
      const off = connect(view)
      // Wrapped before the first await: after it, an unwrapped call runs in the global context.
      const read = wrap(() => ({ state: view.state(), points: view.points(), delta: view.delta() }))
      const choose = wrap((period: '1y') => view.setPeriod(period))
      await vi.waitFor(() => expect(read().state).toBe('ready'))
      expect(read().points?.map((p) => p.kg)).toEqual([84, 83])

      choose('1y')
      await vi.waitFor(() => expect(read().points?.length).toBe(3))
      expect(read().points?.[0]).toEqual({ takenAt: daysAgo(200), kg: 90 })
      expect(read().delta).toBeCloseTo(83 - 90)
      off()
    })
  })

  it('keeps the latest reading when none falls inside the period', async () => {
    const view = await makeView([reading('old', daysAgo(60), 84.6)])
    await context.start(async () => {
      const off = connect(view)
      const read = wrap(() => ({
        state: view.state(),
        latest: view.latest(),
        rows: view.rows(),
        bounds: view.bounds(),
        delta: view.delta(),
      }))
      await vi.waitFor(() => expect(read().state).toBe('no-period-data'))
      expect(read().latest?.id).toBe('old')
      expect(read().rows).toEqual([])
      expect(read().bounds).toBeNull()
      expect(read().delta).toBeNull()
      off()
    })
  })

  it('never flashes empty before the latest reading has loaded', async () => {
    const view = await makeView([reading('old', daysAgo(60), 84.6)])
    await context.start(async () => {
      const seen: string[] = []
      const off = view.state.subscribe((state) => seen.push(state))
      const read = wrap(() => view.state())
      await vi.waitFor(() => expect(read()).toBe('no-period-data'))
      expect(seen).not.toContain('empty')
      off()
    })
  })

  it('is empty when nothing was ever measured', async () => {
    const view = await makeView([])
    await context.start(async () => {
      const off = connect(view)
      const read = wrap(() => ({ state: view.state(), latest: view.latest() }))
      await vi.waitFor(() => expect(read().state).toBe('empty'))
      expect(read().latest).toBeNull()
      off()
    })
  })

  it('ignores readings that carry no weight', async () => {
    const view = await makeView([reading('fat', daysAgo(2))])
    await context.start(async () => {
      const off = connect(view)
      const read = wrap(() => view.state())
      await vi.waitFor(() => expect(read()).toBe('empty'))
      off()
    })
  })

  it('is single with exactly one reading in the period, without a delta', async () => {
    const view = await makeView([reading('old', daysAgo(60), 85), reading('a', daysAgo(3), 83)])
    await context.start(async () => {
      const off = connect(view)
      const read = wrap(() => ({ state: view.state(), delta: view.delta(), bounds: view.bounds() }))
      await vi.waitFor(() => expect(read().state).toBe('single'))
      expect(read().delta).toBeNull()
      expect(read().bounds).toEqual({ min: 83, max: 83 })
      off()
    })
  })

  it('lists rows newest first with the change against the next older one', async () => {
    const view = await makeView([
      reading('a', daysAgo(9), 83.6),
      reading('c', daysAgo(1), 83),
      reading('b', daysAgo(5), 83.3),
    ])
    await context.start(async () => {
      const off = connect(view)
      const read = wrap(() => ({ state: view.state(), rows: view.rows(), bounds: view.bounds() }))
      await vi.waitFor(() => expect(read().state).toBe('ready'))
      const rows = read().rows ?? []
      expect(rows.map((row) => row.id)).toEqual(['c', 'b', 'a'])
      expect(rows[0]?.change).toBeCloseTo(83 - 83.3)
      expect(rows[1]?.change).toBeCloseTo(83.3 - 83.6)
      expect(rows[2]?.change).toBeNull()
      expect(read().bounds).toEqual({ min: 83, max: 83.6 })
      off()
    })
  })

  it('keeps the compact lens on 30 days whatever period is selected', async () => {
    const view = await makeView([reading('old', daysAgo(60), 85), reading('a', daysAgo(3), 83)])
    await context.start(async () => {
      const off = connect(view)
      wrap(() => view.setPeriod('90d'))()
      const read = wrap(() => ({
        state: view.state(),
        compact: view.compact.state(),
        compactPeriod: view.compact.period(),
      }))
      await vi.waitFor(() => expect(read().state).toBe('ready'))
      expect(read().compact).toBe('single')
      expect(read().compactPeriod).toBe('30d')
      off()
    })
  })

  it('reports a module load failure, and retry loads the module again', async () => {
    const { model, ready } = makeTestHealthModel({ measurements: [reading('a', daysAgo(3), 83)] })
    await ready
    const get = vi
      .fn()
      .mockResolvedValueOnce(new ModuleLoadError({ moduleId: 'health', cause: new Error('x') }))
      .mockResolvedValue(model)
    const view = makeWeightView({ get } as unknown as WidgetModules, () => NOW)
    await context.start(async () => {
      const off = connect(view)
      const read = wrap(() => ({ state: view.state(), error: view.error() }))
      const retry = wrap(() => view.retry())
      await vi.waitFor(() => expect(read().state).toBe('error'))
      expect(read().error).toBeInstanceOf(ModuleLoadError)

      await retry()
      await vi.waitFor(() => expect(read().state).toBe('single'))
      expect(read().error).toBeNull()
      expect(get).toHaveBeenCalledTimes(2)
      off()
    })
  })

  it('reports a storage read failure that left nothing loaded, and retry re-reads', async () => {
    const backing = createFakeStorage()
    const seeded = makeTestHealthModel({
      storage: backing,
      measurements: [reading('a', daysAgo(3), 83)],
    })
    await seeded.ready
    // Every connect-time read fails; the model's retry uses `get`, which succeeds.
    const failing: StorageApi = {
      ...backing,
      subscribe: (_key, listener) => {
        queueMicrotask(() => listener(new StorageError({ reason: 'offline' })))
        return () => {}
      },
    }
    const { model } = makeTestHealthModel({ storage: failing })
    const view = makeWeightView(modulesOf(model), () => NOW)
    await context.start(async () => {
      const off = connect(view)
      const read = wrap(() => ({ state: view.state(), error: view.error() }))
      const retry = wrap(() => view.retry())
      await vi.waitFor(() => expect(read().state).toBe('error'))
      expect(read().error).toBeInstanceOf(StorageError)

      await retry()
      await vi.waitFor(() => expect(read().state).toBe('single'))
      off()
    })
  })
})
