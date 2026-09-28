import { context, wrap } from '@reatom/core'
import type { WidgetApi } from '@shared/widgets/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StorageError, WidgetApiError, type StorageApi, type WidgetStorage } from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'
import { createFakeTimer } from 'widget-runtime/timer/fakes'

import type { CatCareEvents } from '../domain/events'
import type { FoodRecord, LedgerEntry, Product } from '../domain/schemas'
import { createCatCareModel } from './cat-care'

const NOW = Date.parse('2026-09-28T12:00:00+02:00')
const PRODUCT: Product = {
  id: 'dry',
  name: 'Сухой корм',
  kind: 'dry',
  completeness: 'complete',
  archived: false,
  defaultPortionGrams: 30,
  nutrition: {
    kcalPer100g: 400,
    proteinPer100g: 35,
    fatPer100g: 18,
    carbsPer100g: null,
    moisturePercent: 8,
  },
}
const FOOD: FoodRecord = {
  id: 'meal-one',
  occurredAt: NOW,
  productId: PRODUCT.id,
  snapshot: {
    name: PRODUCT.name,
    kind: PRODUCT.kind,
    completeness: PRODUCT.completeness,
    nutrition: PRODUCT.nutrition,
  },
  grams: 30,
  mode: 'eaten',
  remainingGrams: null,
  observedAt: null,
  note: '',
}

function fixture(options: { server?: StorageApi; client?: StorageApi; now?: () => number } = {}) {
  const server = options.server ?? createFakeStorage()
  const client = options.client ?? createFakeStorage()
  const storage: WidgetStorage = {
    instance: { server, client },
    shared: { server: createFakeStorage(), client: createFakeStorage() },
  }
  const calls: CatCareEvents['write']['payload'][] = []
  const invoke = vi.fn(async (_event: 'write', payload: CatCareEvents['write']['payload']) => {
    calls.push(payload)
    // HTTP/SSE deliver a fresh decoded array. The generic in-memory helper's
    // append mutates its old reference, which does not model that boundary.
    const previous = await server.get<LedgerEntry[]>('ledger')
    if (previous instanceof Error) return previous
    await server.set('ledger', [
      ...(previous ?? []),
      { id: crypto.randomUUID(), ts: NOW, createdBy: null, ...payload },
    ])
    return { ok: true as const }
  })
  const timer = createFakeTimer({ nowMs: NOW })
  if (options.now) timer.nowMs = options.now
  const model = createCatCareModel({ storage, timer, api: { invoke } as WidgetApi<CatCareEvents> })
  return { model, server, client, invoke, calls }
}

afterEach(() => {
  context.reset()
  vi.useRealTimers()
})

describe('cat care instance model', () => {
  it('restores per-product entry preferences when this diary reconnects', () =>
    context.start(async () => {
      const client = createFakeStorage()
      await wrap(client.set('entry-preferences', { dry: { grams: 42, mode: 'offered' } }))
      const { model } = fixture({ client })
      const unsubscribe = model.state.subscribe(() => {})
      await wrap(
        vi.waitFor(
          wrap(() => expect(model.lastPortions()['dry']).toEqual({ grams: 42, mode: 'offered' })),
        ),
      )
      unsubscribe()
    }))

  it('reads server writes and keeps the saved snapshot after catalog edits and food edits', () =>
    context.start(async () => {
      const { model } = fixture()
      const unsubscribe = model.state.subscribe(() => {})
      await wrap(model.retryLoad())
      expect(await wrap(model.saveProduct(PRODUCT))).toBe(true)
      expect(await wrap(model.saveFood(FOOD))).toBe(true)
      await wrap(vi.waitFor(wrap(() => expect(model.daySummary().eatenKcal).toBe(120))))
      expect(
        await wrap(
          model.saveProduct({ ...PRODUCT, nutrition: { ...PRODUCT.nutrition, kcalPer100g: 100 } }),
        ),
      ).toBe(true)
      expect(await wrap(model.saveFood({ ...FOOD, grams: 20 }))).toBe(true)
      await wrap(vi.waitFor(wrap(() => expect(model.daySummary().eatenKcal).toBe(80))))
      expect(model.lastPortions()['dry']).toEqual({ grams: 20, mode: 'eaten' })
      unsubscribe()
    }))

  it('retains the same mutation id after failure, returns false, and clears the error after retry', () =>
    context.start(async () => {
      const { model, invoke } = fixture()
      const unsubscribe = model.state.subscribe(() => {})
      await wrap(model.retryLoad())
      invoke.mockResolvedValueOnce(
        new WidgetApiError({ code: 'network', reason: 'offline' }) as never,
      )
      expect(await wrap(model.saveProduct(PRODUCT))).toBe(false)
      expect(model.mutationPending()).toBe(false)
      expect(model.mutationError()).toContain('соединения')
      const firstMutation = invoke.mock.calls[0][1].mutationId
      expect(await wrap(model.saveProduct(PRODUCT))).toBe(true)
      expect(invoke.mock.calls[1][1].mutationId).toBe(firstMutation)
      expect(model.mutationError()).toBeNull()
      unsubscribe()
    }))

  it('recovers a failed initial read and does not invent an empty successful load', () =>
    context.start(async () => {
      const storage = createFakeStorage()
      const failure = new StorageError({ reason: 'unavailable' })
      const originalGet = storage.get
      storage.get = async () => failure
      storage.subscribe = (_key, listener) => {
        listener(failure)
        return () => {}
      }
      const { model } = fixture({ server: storage })
      const unsubscribe = model.state.subscribe(() => {})
      await wrap(model.retryLoad())
      expect(model.loadError()).not.toBeNull()
      expect(model.loading()).toBe(false)
      storage.get = originalGet
      expect(await wrap(model.retryLoad())).toBe(true)
      expect(model.loadError()).toBeNull()
      expect(model.state().foods).toEqual([])
      unsubscribe()
    }))

  it('receives an external SSE-style snapshot and reflects deletion', () =>
    context.start(async () => {
      const { model, server } = fixture()
      const unsubscribe = model.state.subscribe(() => {})
      await wrap(model.retryLoad())
      const entries: LedgerEntry[] = [
        {
          id: 'one',
          ts: NOW,
          createdBy: null,
          mutationId: 'one',
          command: { kind: 'food.save', food: FOOD },
        },
      ]
      await wrap(server.set('ledger', entries))
      await wrap(vi.waitFor(wrap(() => expect(model.daySummary().eatenKcal).toBe(120))))
      expect(await wrap(model.deleteRecord('food', FOOD.id))).toBe(true)
      await wrap(vi.waitFor(wrap(() => expect(model.daySummary().eatenKcal).toBe(0))))
      unsubscribe()
    }))

  it.each(['append', 'delete'] as const)(
    'keeps a newer SSE %s when an older refresh resolves and accepts the next fresh read',
    (change) =>
      context.start(async () => {
        const { model, server } = fixture()
        const unsubscribe = model.state.subscribe(() => {})
        await wrap(model.retryLoad())
        const foodEntry: LedgerEntry = {
          id: 'one',
          ts: NOW,
          createdBy: null,
          mutationId: 'one',
          command: { kind: 'food.save', food: FOOD },
        }
        const original = change === 'delete' ? [foodEntry] : []
        await wrap(server.set('ledger', original))
        await wrap(vi.waitFor(wrap(() => expect(model.foods()).toHaveLength(original.length))))
        const originalGet = server.get
        let resolveRead!: (value: LedgerEntry[]) => void
        server.get = vi.fn(
          () =>
            new Promise<LedgerEntry[]>((resolve) => {
              resolveRead = resolve
            }),
        ) as StorageApi['get']
        const pending = model.retryLoad()
        const latest: LedgerEntry[] =
          change === 'append'
            ? [foodEntry]
            : [
                foodEntry,
                {
                  id: 'two',
                  ts: NOW,
                  createdBy: null,
                  mutationId: 'two',
                  command: { kind: 'record.delete', entity: 'food', recordId: FOOD.id },
                },
              ]
        await wrap(server.set('ledger', latest))
        const expected = change === 'append' ? 120 : 0
        await wrap(vi.waitFor(wrap(() => expect(model.daySummary().eatenKcal).toBe(expected))))
        resolveRead(original)
        expect(await wrap(pending)).toBe(true)
        expect(model.daySummary().eatenKcal).toBe(expected)
        // A subsequent read is still accepted when no newer stream update
        // supersedes it; the fence must not permanently disable refreshing.
        server.get = vi.fn(async () => [foodEntry]) as StorageApi['get']
        expect(await wrap(model.retryLoad())).toBe(true)
        expect(model.daySummary().eatenKcal).toBe(120)
        server.get = originalGet
        unsubscribe()
      }),
  )

  it('rolls today over without changing a selected historical day and cleans up its clock', () =>
    context.start(async () => {
      vi.useFakeTimers()
      let current = Date.parse('2026-09-28T23:59:50+02:00')
      const { model } = fixture({ now: () => current })
      const unsubscribe = model.daySummary.subscribe(() => {})
      model.selectedDate.set('2026-09-20')
      expect(model.today()).toBe('2026-09-28')
      current += 60_000
      await wrap(vi.advanceTimersByTimeAsync(60_000))
      expect(model.today()).toBe('2026-09-29')
      expect(model.daySummary().date).toBe('2026-09-20')
      unsubscribe()
      await wrap(vi.advanceTimersByTimeAsync(0))
      expect(vi.getTimerCount()).toBe(0)
    }))

  it('uses a just-saved weight immediately without waiting for the next clock tick', () =>
    context.start(async () => {
      let current = NOW
      const { model } = fixture({ now: () => current })
      const unsubscribe = model.state.subscribe(() => {})
      await wrap(model.retryLoad())
      expect(model.latestWeight()).toBeNull()
      current += 5_000
      const weight = { id: 'weight-now', occurredAt: current, kilograms: 4.2, note: '' }
      expect(await wrap(model.saveWeight(weight))).toBe(true)
      expect(model.latestWeight()).toEqual(weight)
      unsubscribe()
    }))

  it('uses an accepted same-now weight after clock resync but excludes genuinely future weights', () =>
    context.start(async () => {
      const { model, server } = fixture()
      const unsubscribe = model.state.subscribe(() => {})
      await wrap(model.retryLoad())
      const weight = { id: 'weight-now', occurredAt: NOW + 75, kilograms: 4.2, note: '' }
      expect(await wrap(model.saveWeight(weight))).toBe(true)
      expect(model.latestWeight()).toEqual(weight)
      const pastWeight = { ...weight, id: 'past-weight', occurredAt: NOW - 60_000 }
      await wrap(
        server.set('ledger', [
          {
            id: 'past',
            ts: NOW,
            createdBy: null,
            mutationId: 'past',
            command: { kind: 'weight.save', weight: pastWeight },
          },
          {
            id: 'future',
            ts: NOW,
            createdBy: null,
            mutationId: 'future',
            command: { kind: 'weight.save', weight: { ...weight, occurredAt: NOW + 60_001 } },
          },
        ]),
      )
      await wrap(vi.waitFor(wrap(() => expect(model.latestWeight()).toEqual(pastWeight))))
      unsubscribe()
    }))
})
