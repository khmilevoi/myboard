// @vitest-environment node

import type { ModuleServerContext } from '@shared/modules/contracts'
import type { WidgetServerStorage } from '@shared/widgets/contracts'
import { describe, expect, it } from 'vitest'

import type { Measurement } from './domain/measurement'
import healthServer from './server'

const VIEWER = { accountId: 'a1', name: 'Карина' }

function reading(id: string, takenAt: number, kg: number): Measurement {
  return {
    id,
    takenAt,
    metrics: { weight: { value: kg, unit: 'kg' } },
    source: { kind: 'hardware', hardwareId: 'h', model: 'm' },
  }
}

function makeContext(seed: Record<string, unknown> = {}) {
  const store = new Map<string, unknown>(Object.entries(seed))
  const account: WidgetServerStorage = {
    get: async (key: string) => (store.get(key) ?? null) as never,
    set: async (key: string, value: unknown) => void store.set(key, value),
    delete: async (key: string) => void store.delete(key),
    has: async (key: string) => store.has(key),
    keys: async () => [...store.keys()],
    append: async (key: string, value: unknown) => {
      const list = (store.get(key) as unknown[] | undefined) ?? []
      store.set(key, [...list, value])
    },
  } as unknown as WidgetServerStorage

  const context = {
    moduleId: 'health',
    viewer: VIEWER,
    now: () => Date.UTC(2026, 5, 16),
    api: { storage: { account } },
  } as unknown as ModuleServerContext<'account'>
  return { context }
}

const schemas = healthServer.contract.actions
const run = (
  event: keyof typeof healthServer.handlers,
  payload: unknown,
  context: ModuleServerContext<'account'>,
) => healthServer.handlers[event](schemas[event].payload.parse(payload) as never, context)

const PROFILE = { heightCm: 180, birthDate: '1990-01-01', sex: 'male' as const }

describe('health server', () => {
  it('round-trips the profile and returns null when empty', async () => {
    const { context } = makeContext()
    expect(await run('getProfile', {}, context)).toBeNull()
    expect(await run('setProfile', PROFILE, context)).toEqual({ ok: true })
    expect(await run('getProfile', {}, context)).toEqual(PROFILE)
  })

  it('lists the merged, sorted series clipped to the range', async () => {
    const may1 = Date.UTC(2026, 4, 1, 8)
    const may20 = Date.UTC(2026, 4, 20, 8)
    const jun2 = Date.UTC(2026, 5, 2, 8)
    const jun30 = Date.UTC(2026, 5, 30, 8)
    const { context } = makeContext({
      'measurements/2026-05': [reading('b', may20, 80), reading('a', may1, 81)],
      'measurements/2026-06': [reading('c', jun2, 79), reading('d', jun30, 78)],
    })

    const out = (await run('listMeasurements', { from: may20, to: jun2 }, context)) as Measurement[]
    expect(out.map((m) => m.id)).toEqual(['b', 'c'])
  })

  it('filters by kinds', async () => {
    const t = Date.UTC(2026, 5, 2)
    const fat: Measurement = {
      ...reading('f', t + 1, 0),
      metrics: { 'body-fat': { value: 20, unit: '%' } },
    }
    const { context } = makeContext({ 'measurements/2026-06': [reading('w', t, 80), fat] })
    const out = (await run(
      'listMeasurements',
      { kinds: ['body-fat'], from: t, to: t + 10 },
      context,
    )) as Measurement[]
    expect(out.map((m) => m.id)).toEqual(['f'])
  })

  it('returns the latest record of a kind', async () => {
    const m = reading('x', Date.UTC(2026, 5, 2), 80)
    const { context } = makeContext({ 'latest/weight': m })
    expect(await run('latestMeasurement', { kind: 'weight' }, context)).toEqual(m)
    expect(await run('latestMeasurement', { kind: 'muscle' }, context)).toBeNull()
  })

  it('rejects from > to and spans over 60 months in the payload schema', () => {
    const payload = schemas.listMeasurements.payload
    expect(payload.safeParse({ from: 10, to: 5 }).success).toBe(false)
    expect(payload.safeParse({ from: 0, to: Date.UTC(2026, 0, 1) }).success).toBe(false)
    expect(
      payload.safeParse({ from: Date.UTC(2021, 0, 1), to: Date.UTC(2025, 11, 31) }).success,
    ).toBe(true)
    expect(
      payload.safeParse({ from: Date.UTC(2021, 0, 1), to: Date.UTC(2026, 0, 1) }).success,
    ).toBe(false)
  })
})
