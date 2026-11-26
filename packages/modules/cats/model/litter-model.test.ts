import { atom, context, wrap } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  makeStaticWidgetIdentity,
  ModuleApiError,
  StorageError,
  type StorageApi,
} from 'widget-runtime'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'
import { createFakeTimer } from 'widget-runtime/timer/fakes'

import { foldDebt } from '../domain/debt'
import { OFELIA_ID } from '../domain/ids'
import { ledgerKey } from '../domain/keys'
import type { LedgerEntry } from '../domain/ledger'
import { DEFAULT_LITTER_SETTINGS, type LitterSettings } from '../domain/roster'
import { memberStats } from '../domain/stats'
import { toHistoryGroups } from './history-view'
import { makeLitterModel, type CatsModuleContext } from './litter-model'
import { makeTestLitterModel } from './testing'

const D = (iso: string) => Temporal.PlainDate.from(iso)

// 2026-06-16 is Леша's base duty day; 2026-06-15 is the Monday of that week.
const ENTRIES: LedgerEntry[] = [
  { id: 'e1', ts: 1, date: '2026-06-15', type: 'cleaned', actor: 'Карина' },
  { id: 'e2', ts: 2, date: '2026-06-16', type: 'cleaned', actor: 'Леша' },
  { id: 'e3', ts: 3, date: '2026-06-16', type: 'reset', actor: 'Леша' },
  {
    id: 'e4',
    ts: 4,
    date: '2026-06-17',
    type: 'went_into_debt',
    actor: 'Карина',
    onBehalfOf: 'Карина',
  },
]

function makeContext(
  overrides: Partial<StorageApi> = {},
  today: Temporal.PlainDate | null = D('2026-06-17'),
): CatsModuleContext {
  const api = { ...createFakeStorage(), ...overrides }
  return {
    moduleId: 'cats',
    storage: { shared: { client: api, server: api } },
    api: { invoke: vi.fn(async () => ({ ok: true })) } as CatsModuleContext['api'],
    timer: createFakeTimer({ today }),
    identity: makeStaticWidgetIdentity(),
  }
}

afterEach(() => {
  context.reset()
})

describe('makeLitterModel before the ledger and the clock arrive', () => {
  it('returns null projections and an empty resolution map', () => {
    const { model } = makeTestLitterModel()

    expect(model.today()).toBeNull()
    expect(model.ledger()).toBeNull()
    expect(model.settings()).toBeNull()
    expect(model.numberOfDebts()).toBeNull()
    expect(model.dayResolution().size).toBe(0)
    expect(model.debtDays()).toBeNull()
    expect(model.memberStats()).toBeNull()
  })
})

const SWAPPED: LitterSettings = { rotation: ['Карина', 'Леша'], baseDate: '2026-06-16' }

describe('makeLitterModel litter settings', () => {
  const readSettings = async (settings?: unknown) => {
    const { model } = makeTestLitterModel({ entries: ENTRIES, todayIso: '2026-06-17', settings })
    return context.start(async () => {
      const off = model.settings.subscribe(() => {})
      const read = wrap(() => model.settings())
      await vi.waitFor(() => expect(read()).not.toBeNull())
      const value = read()
      off()
      return value
    })
  }

  it('is the default settings when the key is absent', async () => {
    expect(await readSettings()).toEqual(DEFAULT_LITTER_SETTINGS)
  })

  it('is the stored settings when they parse', async () => {
    expect(await readSettings(SWAPPED)).toEqual(SWAPPED)
  })

  it('falls back to the default settings when the stored value does not parse', async () => {
    expect(await readSettings({ rotation: 'junk' })).toEqual(DEFAULT_LITTER_SETTINGS)
  })

  it('resolves a went_into_debt entry by the stored rotation', async () => {
    // e4 is a missed turn on 2026-06-17, billed only when that day was Карина's own.
    const { model } = makeTestLitterModel({
      entries: ENTRIES,
      todayIso: '2026-06-17',
      settings: SWAPPED,
    })

    await context.start(async () => {
      const off = model.numberOfDebts.subscribe(() => {})
      const read = wrap(() => model.numberOfDebts())
      await vi.waitFor(() => expect(read()).not.toBeNull())

      // Swapped, 2026-06-17 is Леша's day, so Карина's missed "own" turn bills nobody.
      expect(read()).toEqual({ Леша: 0, Карина: 0 })
      expect(read()).not.toEqual(foldDebt(DEFAULT_LITTER_SETTINGS, ENTRIES))
      off()
    })
  })
})

describe('makeLitterModel ledger projections', () => {
  it('loads the ledger and derives debts, resolutions, debt days and stats', async () => {
    const { model } = makeTestLitterModel({ entries: ENTRIES, todayIso: '2026-06-17' })

    await context.start(async () => {
      const offs = [model.debtDays.subscribe(() => {}), model.memberStats.subscribe(() => {})]
      const read = wrap(() => ({
        ledger: model.ledger(),
        loading: model.ledgerLoading(),
        debts: model.numberOfDebts(),
        resolution: model.dayResolution(),
        debtDays: model.debtDays(),
        stats: model.memberStats(),
      }))

      await vi.waitFor(() => expect(read().ledger).toEqual(ENTRIES))
      await vi.waitFor(() => expect(read().stats).not.toBeNull())
      const state = read()

      expect(state.loading).toBe(false)
      expect(state.debts).toEqual(foldDebt(DEFAULT_LITTER_SETTINGS, ENTRIES))
      expect(state.resolution.get('2026-06-15')).toEqual({
        status: 'closed',
        type: 'cleaned',
        actor: 'Карина',
      })
      expect(state.resolution.get('2026-06-16')?.status).toBe('pending')
      expect(state.debtDays).toBeInstanceOf(Map)
      expect(state.stats).toEqual(
        memberStats({
          settings: DEFAULT_LITTER_SETTINGS,
          entries: ENTRIES,
          today: D('2026-06-17'),
          windowDays: 30,
        }),
      )

      for (const off of offs) off()
    })
  })

  it('groups the history of the week its own atom points at', async () => {
    const { model } = makeTestLitterModel({ entries: ENTRIES, todayIso: '2026-06-17' })
    const week = atom<Temporal.PlainDate | null>(D('2026-06-15'), 'test.week')
    const history = model.historyFor(week)

    await context.start(async () => {
      const off = history.subscribe(() => {})
      const readHistory = wrap(() => history())
      const setWeek = wrap((next: Temporal.PlainDate | null) => week.set(next))

      await vi.waitFor(() => expect(readHistory()).toHaveLength(3))
      expect(readHistory()).toEqual(
        toHistoryGroups({
          settings: DEFAULT_LITTER_SETTINGS,
          entries: ENTRIES,
          weekStartIso: '2026-06-15',
          members: new Map(),
          viewerAccountId: null,
        }),
      )

      setWeek(D('2026-06-22'))
      await vi.waitFor(() => expect(readHistory()).toEqual([]))

      setWeek(null)
      expect(readHistory()).toEqual([])

      off()
    })
  })
})

describe('makeLitterModel.retryLedger (F2c)', () => {
  it('re-fetches the ledger through the same public API and clears a previous failure', async () => {
    const get = vi.fn(async () => [] as LedgerEntry[]) as unknown as StorageApi['get']
    const model = makeLitterModel(makeContext({ get }), OFELIA_ID)
    model.ledgerError.set(new StorageError({ reason: 'boom' }))

    await wrap(() => model.retryLedger())()

    expect(get).toHaveBeenCalledWith(ledgerKey(OFELIA_ID), expect.anything())
    expect(model.ledgerError()).toBeNull()
    expect(model.ledgerLoading()).toBe(false)
    expect(model.ledger()).toEqual([])
  })

  it('records a failed retry rather than silently leaving the model stuck', async () => {
    const failure = new StorageError({ reason: 'still down' })
    const get = vi.fn(async () => failure) as unknown as StorageApi['get']
    const model = makeLitterModel(makeContext({ get }), OFELIA_ID)

    await wrap(() => model.retryLedger())()

    expect(model.ledgerError()).toBe(failure)
    expect(model.ledgerLoading()).toBe(false)
  })
})

describe('makeLitterModel.runDayAction', () => {
  it('invokes the matching action with the ISO date', async () => {
    const { model, calls } = makeTestLitterModel({ todayIso: '2026-06-16' })

    expect(await wrap(() => model.runDayAction('clean', D('2026-06-18')))()).toBeUndefined()
    await wrap(() => model.runDayAction('debt', D('2026-06-16')))()
    await wrap(() => model.runDayAction('forgive', D('2026-06-17')))()
    await wrap(() => model.runDayAction('undo', D('2026-06-19')))()

    expect(calls).toEqual([
      { action: 'clean', payload: { litterId: 'ofelia', date: '2026-06-18' } },
      { action: 'debt', payload: { litterId: 'ofelia', date: '2026-06-16' } },
      { action: 'forgive', payload: { litterId: 'ofelia', date: '2026-06-17' } },
      { action: 'undo', payload: { litterId: 'ofelia', date: '2026-06-19' } },
    ])
  })

  it('returns the ModuleApiError the API returns instead of throwing', async () => {
    const failure = new ModuleApiError({ reason: 'offline', code: 'network' })
    const { model, calls } = makeTestLitterModel({ invoke: async () => failure })

    const result = await wrap(() => model.runDayAction('clean', D('2026-06-18')))()

    expect(calls).toEqual([
      { action: 'clean', payload: { litterId: 'ofelia', date: '2026-06-18' } },
    ])
    expect(result).toBe(failure)
  })
})

describe('makeLitterModel.sendComment', () => {
  it('invokes the comment action for the Monday of the given week', async () => {
    const { model, calls } = makeTestLitterModel()

    await wrap(() => model.sendComment(D('2026-06-17'), '  Привет  '))()

    expect(calls).toEqual([
      {
        action: 'comment',
        payload: { litterId: 'ofelia', weekStart: '2026-06-15', text: '  Привет  ' },
      },
    ])
  })

  it('ignores empty or whitespace-only text', async () => {
    const { model, calls } = makeTestLitterModel()

    await wrap(() => model.sendComment(D('2026-06-15'), '   '))()

    expect(calls).toEqual([])
  })

  it('returns the ModuleApiError the API returns', async () => {
    const failure = new ModuleApiError({ reason: 'boom', code: 'internal_error' })
    const { model } = makeTestLitterModel({ invoke: async () => failure })

    expect(await wrap(() => model.sendComment(D('2026-06-15'), 'hi'))()).toBe(failure)
  })
})
