// @vitest-environment node

import type { WidgetServerContext, WidgetServerStorage } from '@shared/widgets/contracts'
import { describe, expect, it, vi } from 'vitest'

import type { CatCareCommand, LedgerEntry } from './domain/schemas'
import server from './server'

const NOW = Date.parse('2026-09-28T12:00:00+02:00')
const PROFILE = {
  name: 'Офелия',
  birthDate: '2022-03-12',
  neutered: true,
  timeZone: 'Europe/Warsaw',
  bodyConditionScore: 5,
  calorieTarget: null,
}
const command: CatCareCommand = { kind: 'profile.save', profile: PROFILE }

function fixture(initial: LedgerEntry[] = []) {
  const entries = [...initial]
  const instance: WidgetServerStorage = {
    get: vi.fn(async () => [...entries] as never),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    keys: vi.fn(async () => []),
    append: vi.fn(async (key, entry, options) => {
      expect(key).toBe('ledger')
      expect(options).toBeUndefined()
      entries.push({ id: `event-${entries.length}`, ts: NOW, ...entry } as LedgerEntry)
    }),
  }
  const shared = { ...instance, append: vi.fn(async () => undefined) }
  const context: WidgetServerContext = {
    typeId: 'cat-care',
    instanceId: 'cat-one',
    ip: null,
    viewer: { accountId: 'person-1', name: 'Лёша' },
    now: () => NOW,
    api: { storage: { instance, shared }, browser: {} as never },
  }
  return { entries, context, instance, shared }
}

function pauseFirstAppend(instance: WidgetServerStorage) {
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const append = instance.append
  vi.spyOn(instance, 'append').mockImplementationOnce(async (...args) => {
    entered.resolve()
    await release.promise
    return append(...args)
  })
  return { entered: entered.promise, release: release.resolve }
}

describe('cat-care server journal', () => {
  it('stamps the session author and appends only to this cat without a history cap', async () => {
    const { context, entries, shared } = fixture()
    const request = { mutationId: 'request-one', command, createdBy: { name: 'forged' } }
    expect(await server.handlers.write(request, context)).toEqual({ ok: true })
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      mutationId: 'request-one',
      command,
      createdBy: context.viewer,
    })
    expect(shared.append).not.toHaveBeenCalled()
  })

  it('does not append a successful retry twice, even if the original response was lost', async () => {
    const { context, entries } = fixture()
    const request = { mutationId: 'request-one', command }
    await server.handlers.write(request, context)
    await server.handlers.write(request, context)
    expect(entries).toHaveLength(1)
  })

  it('refuses reuse of a mutation id for different data', async () => {
    const { context, entries } = fixture()
    await server.handlers.write({ mutationId: 'request-one', command }, context)
    const result = await server.handlers.write(
      {
        mutationId: 'request-one',
        command: { kind: 'profile.save', profile: { ...PROFILE, name: 'Другая' } },
      },
      context,
    )
    expect(result).toBeInstanceOf(Error)
    expect(entries).toHaveLength(1)
  })

  it('deduplicates overlapping retries while the first append is pending', async () => {
    const { context, instance, entries } = fixture()
    const pause = pauseFirstAppend(instance)
    const request = { mutationId: 'overlapping', command }
    const first = server.handlers.write(request, context)
    await pause.entered
    const retry = server.handlers.write(request, context)
    await Promise.resolve()
    pause.release()
    expect(await Promise.all([first, retry])).toEqual([{ ok: true }, { ok: true }])
    expect(entries).toHaveLength(1)
  })

  it('rejects an overlapping mutation-id collision after the first write settles', async () => {
    const { context, instance, entries } = fixture()
    const pause = pauseFirstAppend(instance)
    const first = server.handlers.write({ mutationId: 'collision', command }, context)
    await pause.entered
    const collision = server.handlers.write(
      {
        mutationId: 'collision',
        command: { kind: 'profile.save', profile: { ...PROFILE, name: 'Другая' } },
      },
      context,
    )
    await Promise.resolve()
    pause.release()
    expect(await first).toEqual({ ok: true })
    expect(await collision).toBeInstanceOf(Error)
    expect(entries).toHaveLength(1)
  })

  it('validates concurrent water losses against the preceding completed write', async () => {
    const { context, instance, entries } = fixture()
    const water = {
      id: 'baseline',
      occurredAt: NOW - 3_000,
      kind: 'replace' as const,
      addedMl: 100,
      remainingMl: null,
      discardedMl: 0,
      unmeasuredLoss: false,
      note: '',
    }
    await server.handlers.write(
      { mutationId: 'baseline', command: { kind: 'water.save', water } },
      context,
    )
    const pause = pauseFirstAppend(instance)
    const first = server.handlers.write(
      {
        mutationId: 'loss-one',
        command: {
          kind: 'water.save',
          water: {
            ...water,
            id: 'loss-one',
            occurredAt: NOW - 2_000,
            kind: 'topup',
            addedMl: 0,
            discardedMl: 60,
          },
        },
      },
      context,
    )
    await pause.entered
    const second = server.handlers.write(
      {
        mutationId: 'loss-two',
        command: {
          kind: 'water.save',
          water: {
            ...water,
            id: 'loss-two',
            occurredAt: NOW - 1_000,
            kind: 'topup',
            addedMl: 0,
            discardedMl: 60,
          },
        },
      },
      context,
    )
    await Promise.resolve()
    pause.release()
    expect(await first).toEqual({ ok: true })
    expect(await second).toMatchObject({ code: 'cat_care_invalid_water_balance' })
    expect(entries).toHaveLength(2)
  })

  it('does not block another cat while one instance waits for storage', async () => {
    const firstCat = fixture()
    const secondCat = fixture()
    secondCat.context.instanceId = 'cat-two'
    const pause = pauseFirstAppend(firstCat.instance)
    const first = server.handlers.write({ mutationId: 'first', command }, firstCat.context)
    await pause.entered
    try {
      expect(
        await server.handlers.write({ mutationId: 'second', command }, secondCat.context),
      ).toEqual({ ok: true })
      expect(firstCat.entries).toHaveLength(0)
      expect(secondCat.entries).toHaveLength(1)
    } finally {
      pause.release()
      await first
    }
  })

  it('rejects an impossible future observation without appending', async () => {
    const { context, entries } = fixture()
    const result = await server.handlers.write(
      {
        mutationId: 'future',
        command: {
          kind: 'weight.save',
          weight: { id: 'w', occurredAt: NOW + 120_000, kilograms: 4.1, note: '' },
        },
      },
      context,
    )
    expect(result).toBeInstanceOf(Error)
    expect(entries).toHaveLength(0)
  })

  it('returns storage failures and writes nothing after a failed read', async () => {
    const { context, instance, entries } = fixture()
    const failure = new Error('unavailable')
    instance.get = async () => failure
    expect(await server.handlers.write({ mutationId: 'r', command }, context)).toBe(failure)
    expect(entries).toHaveLength(0)
    instance.get = async () => [] as never
    instance.append = async () => failure
    expect(await server.handlers.write({ mutationId: 'r', command }, context)).toBe(failure)
  })

  it('keeps prior observations when the journal grows beyond common recent-history limits', async () => {
    const { context, entries } = fixture(
      Array.from({ length: 1001 }, (_, index) => ({
        id: `event-${index}`,
        ts: NOW - 100_000 + index,
        createdBy: null,
        mutationId: `old-${index}`,
        command: {
          kind: 'weight.save',
          weight: {
            id: `weight-${index}`,
            occurredAt: NOW - 100_000 + index,
            kilograms: 4,
            note: '',
          },
        },
      })),
    )
    await server.handlers.write({ mutationId: 'r', command }, context)
    expect(entries).toHaveLength(1002)
    expect(entries[0].mutationId).toBe('old-0')
  })
})
