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
import { LEDGER_KEY } from '../domain/keys'
import type { LedgerEntry } from '../domain/ledger'
import { memberStats } from '../domain/stats'
import { toHistoryGroups } from './history-view'
import { makeOfeliaModel, type OfeliaModuleContext } from './ofelia-model'
import { makeTestOfeliaModel } from './testing'

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
): OfeliaModuleContext {
  const api = { ...createFakeStorage(), ...overrides }
  return {
    moduleId: 'ofelia',
    storage: { shared: { client: api, server: api } },
    api: { invoke: vi.fn(async () => ({ ok: true })) } as OfeliaModuleContext['api'],
    timer: createFakeTimer({ today }),
    identity: makeStaticWidgetIdentity(),
  }
}

afterEach(() => {
  context.reset()
})

describe('makeOfeliaModel before the ledger and the clock arrive', () => {
  it('returns null projections and an empty resolution map', () => {
    const { model } = makeTestOfeliaModel()

    expect(model.today()).toBeNull()
    expect(model.ledger()).toBeNull()
    expect(model.numberOfDebts()).toBeNull()
    expect(model.dayResolution().size).toBe(0)
    expect(model.debtDays()).toBeNull()
    expect(model.memberStats()).toBeNull()
  })
})

describe('makeOfeliaModel ledger projections', () => {
  it('loads the ledger and derives debts, resolutions, debt days and stats', async () => {
    const { model } = makeTestOfeliaModel({ entries: ENTRIES, todayIso: '2026-06-17' })

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
      const state = read()

      expect(state.loading).toBe(false)
      expect(state.debts).toEqual(foldDebt(ENTRIES))
      expect(state.resolution.get('2026-06-15')).toEqual({
        status: 'closed',
        type: 'cleaned',
        actor: 'Карина',
      })
      expect(state.resolution.get('2026-06-16')?.status).toBe('pending')
      expect(state.debtDays).toBeInstanceOf(Map)
      expect(state.stats).toEqual(
        memberStats({ entries: ENTRIES, today: D('2026-06-17'), windowDays: 30 }),
      )

      for (const off of offs) off()
    })
  })

  it('groups the history of the week its own atom points at', async () => {
    const { model } = makeTestOfeliaModel({ entries: ENTRIES, todayIso: '2026-06-17' })
    const week = atom<Temporal.PlainDate | null>(D('2026-06-15'), 'test.week')
    const history = model.historyFor(week)

    await context.start(async () => {
      const off = history.subscribe(() => {})
      const readHistory = wrap(() => history())
      const setWeek = wrap((next: Temporal.PlainDate | null) => week.set(next))

      await vi.waitFor(() => expect(readHistory()).toHaveLength(3))
      expect(readHistory()).toEqual(
        toHistoryGroups({
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

describe('makeOfeliaModel.retryLedger (F2c)', () => {
  it('re-fetches the ledger through the same public API and clears a previous failure', async () => {
    const get = vi.fn(async () => [] as LedgerEntry[]) as unknown as StorageApi['get']
    const model = makeOfeliaModel(makeContext({ get }))
    model.ledgerError.set(new StorageError({ reason: 'boom' }))

    await wrap(() => model.retryLedger())()

    expect(get).toHaveBeenCalledWith(LEDGER_KEY, expect.anything())
    expect(model.ledgerError()).toBeNull()
    expect(model.ledgerLoading()).toBe(false)
    expect(model.ledger()).toEqual([])
  })

  it('records a failed retry rather than silently leaving the model stuck', async () => {
    const failure = new StorageError({ reason: 'still down' })
    const get = vi.fn(async () => failure) as unknown as StorageApi['get']
    const model = makeOfeliaModel(makeContext({ get }))

    await wrap(() => model.retryLedger())()

    expect(model.ledgerError()).toBe(failure)
    expect(model.ledgerLoading()).toBe(false)
  })
})

describe('makeOfeliaModel.runDayAction', () => {
  it('invokes the matching action with the ISO date', async () => {
    const { model, calls } = makeTestOfeliaModel({ todayIso: '2026-06-16' })

    expect(await wrap(() => model.runDayAction('clean', D('2026-06-18')))()).toBeUndefined()
    await wrap(() => model.runDayAction('debt', D('2026-06-16')))()
    await wrap(() => model.runDayAction('forgive', D('2026-06-17')))()
    await wrap(() => model.runDayAction('undo', D('2026-06-19')))()

    expect(calls).toEqual([
      { action: 'clean', payload: { date: '2026-06-18' } },
      { action: 'debt', payload: { date: '2026-06-16' } },
      { action: 'forgive', payload: { date: '2026-06-17' } },
      { action: 'undo', payload: { date: '2026-06-19' } },
    ])
  })

  it('returns the ModuleApiError the API returns instead of throwing', async () => {
    const failure = new ModuleApiError({ reason: 'offline', code: 'network' })
    const { model, calls } = makeTestOfeliaModel({ invoke: async () => failure })

    const result = await wrap(() => model.runDayAction('clean', D('2026-06-18')))()

    expect(calls).toEqual([{ action: 'clean', payload: { date: '2026-06-18' } }])
    expect(result).toBe(failure)
  })
})

describe('makeOfeliaModel.sendComment', () => {
  it('invokes the comment action for the Monday of the given week', async () => {
    const { model, calls } = makeTestOfeliaModel()

    await wrap(() => model.sendComment(D('2026-06-17'), '  Привет  '))()

    expect(calls).toEqual([
      { action: 'comment', payload: { weekStart: '2026-06-15', text: '  Привет  ' } },
    ])
  })

  it('ignores empty or whitespace-only text', async () => {
    const { model, calls } = makeTestOfeliaModel()

    await wrap(() => model.sendComment(D('2026-06-15'), '   '))()

    expect(calls).toEqual([])
  })

  it('returns the ModuleApiError the API returns', async () => {
    const failure = new ModuleApiError({ reason: 'boom', code: 'internal_error' })
    const { model } = makeTestOfeliaModel({ invoke: async () => failure })

    expect(await wrap(() => model.sendComment(D('2026-06-15'), 'hi'))()).toBe(failure)
  })
})
