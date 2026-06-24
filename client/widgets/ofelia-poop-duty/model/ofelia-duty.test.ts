import 'fake-indexeddb/auto'
import { context, wrap } from '@reatom/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createFakeTimer } from '@/shared/timer/model/fakes'
import { db } from '@/storage/model/client/db'
import { createDexieStorage } from '@/storage/model/client/dexie-storage'
import { instanceNamespace } from '@/storage/model/scope'
import { installFakeBroadcastChannel } from '@/storage/model/test/fakes'
import type { StorageApi, StorageChange, StorageListener } from '@/storage/model/types'
import type { WidgetStorage } from '@/storage/model/widget-storage'

import {
  DEBT_WARNING_THRESHOLD,
  effectiveDuty,
  IP_TAIL_LENGTH,
  isDebtDay,
  isOverDebtWarning,
  LEDGER_KEY,
  ofeliaDutyModel,
  otherPerson,
  weekStartISO,
} from './ofelia-duty'
import type { LedgerEntry } from './ofelia-duty'

function createStorage(overrides: Partial<StorageApi> = {}): WidgetStorage {
  const api: StorageApi = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    keys: vi.fn(async () => []),
    append: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => {}),
    ...overrides,
  }

  return {
    instance: { client: api, server: api },
    shared: { client: api, server: api },
  }
}

let seq = 0
const le = (o: Partial<LedgerEntry> = {}): LedgerEntry => ({
  id: `e${seq++}`,
  ts: seq,
  ip: '127.0.0.1',
  date: '2026-06-16',
  type: 'cleaned',
  actor: 'Леша',
  by: 'Леша',
  ...o,
})

let storageSeq = 0
function createLedgerStorage() {
  const real = createDexieStorage(instanceNamespace(`ofelia-ledger-${storageSeq++}`))
  const append = vi.fn(real.append)
  const set = vi.fn(real.set)
  const subscribe = vi.fn(real.subscribe) as unknown as StorageApi['subscribe']
  const storage = createStorage({ ...real, append, set, subscribe })
  const emit = async (value: LedgerEntry[] | null) => {
    await vi.waitFor(() =>
      expect(subscribe).toHaveBeenCalledWith(LEDGER_KEY, expect.any(Function), expect.anything()),
    )
    const listener = vi.mocked(subscribe).mock.calls.at(-1)?.[1] as
      | StorageListener<LedgerEntry[] | null>
      | undefined
    expect(listener).toBeTypeOf('function')
    await wrap(() => listener?.({ value } satisfies StorageChange<LedgerEntry[]>))()
  }
  return { storage, append, subscribe, emit }
}

const D = (iso: string) => Temporal.PlainDate.from(iso)

beforeEach(async () => {
  installFakeBroadcastChannel()
  await db.entries.clear()
})

afterEach(() => {
  context.reset()
  vi.unstubAllGlobals()
})

describe('ofeliaDutyModel server time', () => {
  it('returns null projections and blocks actions before the first sync', async () => {
    const { storage } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer() })

    expect(model.viewWeekStart()).toBeNull()
    expect(model.currentWeek()).toBeNull()
    expect(model.debtDays()).toBeNull()

    await model.goIntoDebt()
    expect(storage.shared.server.append).not.toHaveBeenCalled()
  })

  it('blocks append actions while the ledger has not synced yet', async () => {
    const { storage } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })

    await model.confirmClean(D('2026-06-16'))
    await model.goIntoDebt(D('2026-06-16'))
    await model.forgive(D('2026-06-16'))
    await model.undo(D('2026-06-16'))

    expect(storage.shared.server.append).not.toHaveBeenCalled()
  })

  it('derives the week from server today once synced', () => {
    const { storage, emit } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })

    return context.start(async () => {
      const off = model.currentWeek.subscribe(() => {})
      await emit([])
      await vi.waitFor(() => expect(model.currentWeek()).not.toBeNull())
      const week = model.currentWeek()
      expect(week?.find((day) => day.isToday)?.date.toString()).toBe('2026-06-16')
      expect(model.viewWeekStart()?.toString()).toBe('2026-06-15')
      off()
    })
  })

  it('exposes today so the view model can gate future-day controls', () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: Temporal.PlainDate.from('2026-06-16') }),
    })

    expect(model.today()?.toString()).toBe('2026-06-16')
  })

  it('navigates weeks via the override and resets to the current week', () => {
    const { storage, emit } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })

    return context.start(async () => {
      const off = model.currentWeek.subscribe(() => {})
      await emit([])

      model.goToNextWeek()
      expect(model.viewWeekStart()?.toString()).toBe('2026-06-22')

      model.goToPrevWeek()
      expect(model.viewWeekStart()?.toString()).toBe('2026-06-15')

      model.goToNextWeek()
      model.goToCurrentWeek()
      expect(model.viewWeekStart()?.toString()).toBe('2026-06-15')
      off()
    })
  })

  it('selects a day and resolves the default to today', () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: Temporal.PlainDate.from('2026-06-16') }),
    })

    expect(model.selectedDate()).toBeNull()

    model.selectedDate.set(Temporal.PlainDate.from('2026-06-15'))
    expect(model.selectedDate()?.toString()).toBe('2026-06-15')
  })

  it('allows undo only when today is closed and selected', async () => {
    const { storage, emit } = createLedgerStorage()
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer({ today: D('2026-06-16') }),
    })

    await context.start(async () => {
      const off = model.undoAvailable.subscribe(() => {})

      expect(model.undoAvailable()).toBe(false)

      await emit([le({ date: '2026-06-16', type: 'cleaned', actor: 'Леша', by: 'Леша' })])
      await vi.waitFor(() => expect(model.undoAvailable()).toBe(true))

      model.selectedDate.set(D('2026-06-15'))
      expect(model.undoAvailable()).toBe(false)

      model.selectedDate.set(D('2026-06-16'))
      expect(model.undoAvailable()).toBe(true)

      off()
    })
  })

  it('blocks undo before the first sync', () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer(),
    })

    expect(model.undoAvailable()).toBe(false)
  })
})

describe('ofeliaDutyModel.currentUser', () => {
  it('defaults to the first roster member', () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer(),
    })

    expect(model.currentUser()).toBe('Леша')
  })

  it('loads a persisted value from shared.client on connect', async () => {
    const storage = createStorage({
      get: (async () => 'Карина') as StorageApi['get'],
    })
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer(),
    })

    await context.start(async () => {
      const off = model.currentUser.subscribe(() => {})
      const check = wrap(() => expect(model.currentUser()).toBe('Карина'))

      await vi.waitFor(() => check())
      off()
    })
  })

  it('persists the selection to shared.client on change', async () => {
    const storage = createStorage()
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer(),
    })

    await context.start(async () => {
      const off = model.currentUser.subscribe(() => {})
      await wrap(() => model.currentUser.set('Карина'))()

      const check = wrap(() =>
        expect(storage.shared.client.set).toHaveBeenCalledWith('currentUser', 'Карина'),
      )

      await vi.waitFor(() => check())
      off()
    })
  })
})

describe('ofeliaDutyModel.historyView', () => {
  it('maps ledger entries for the viewed week newest-first with an IP tail', async () => {
    const { storage, emit } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })

    await context.start(async () => {
      const off = model.historyView.subscribe(() => {})
      await emit([
        le({ id: 'a', ts: 1, ip: '10.0.0.11', date: '2026-06-16', type: 'cleaned' }),
        le({
          id: 'b',
          ts: 3,
          ip: '10.0.0.22',
          date: '2026-06-16',
          type: 'went_into_debt',
          actor: 'Карина',
          onBehalfOf: 'Леша',
        }),
        le({
          id: 'c',
          ts: 2,
          ip: '10.0.0.33',
          date: '2026-06-16',
          type: 'forgiven',
          actor: 'Карина',
          onBehalfOf: 'Леша',
        }),
      ])
      await vi.waitFor(() => expect(model.historyView()).toHaveLength(3))
      const view = model.historyView()
      expect(view.map((entry) => entry.id)).toEqual(['b', 'c', 'a'])
      expect(view[0]).toMatchObject({
        id: 'b',
        type: 'went_into_debt',
        onBehalfOf: 'Леша',
        ipTail: '.0.22',
      })
      off()
    })
  })

  it('sorts by date first, then by newest event within the date', async () => {
    const { storage, emit } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-24') }) })

    await context.start(async () => {
      const off = model.historyView.subscribe(() => {})
      await emit([
        le({
          id: 'older-day-late-write',
          ts: 9,
          date: '2026-06-22',
          type: 'reset',
          actor: 'Карина',
        }),
        le({ id: 'newest-day', ts: 2, date: '2026-06-24', type: 'cleaned', actor: 'Леша' }),
        le({ id: 'middle-day', ts: 5, date: '2026-06-23', type: 'cleaned', actor: 'Карина' }),
        le({
          id: 'newest-day-newer-write',
          ts: 3,
          date: '2026-06-24',
          type: 'went_into_debt',
          actor: 'Карина',
          onBehalfOf: 'Леша',
        }),
      ])
      await vi.waitFor(() => expect(model.historyView()).toHaveLength(4))
      expect(model.historyView().map((entry) => entry.id)).toEqual([
        'newest-day-newer-write',
        'newest-day',
        'middle-day',
        'older-day-late-write',
      ])
      off()
    })
  })

  it('omits onBehalfOf when the entry has none', async () => {
    const { storage, emit } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })
    await context.start(async () => {
      const off = model.historyView.subscribe(() => {})
      await emit([le({ id: 'a', ts: 1, type: 'cleaned', actor: 'Леша', by: 'Леша' })])
      await vi.waitFor(() => expect(model.historyView()).toHaveLength(1))
      expect(model.historyView()[0]?.onBehalfOf).toBeUndefined()
      off()
    })
  })
})

describe('ofeliaDutyModel.confirmClean', () => {
  it('on a plain day appends cleaned with no onBehalfOf', async () => {
    const { storage, emit } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })
    await context.start(async () => {
      const off = model.numberOfDebts.subscribe(() => {})
      await emit([])
      await model.confirmClean(D('2026-06-17'))
      off()
    })

    expect(storage.shared.server.append).toHaveBeenCalledWith(LEDGER_KEY, {
      date: '2026-06-17',
      type: 'cleaned',
      actor: 'Карина',
      by: 'Леша',
    })
    expect(storage.shared.server.set).not.toHaveBeenCalledWith('debts', expect.anything())
  })

  it('on a debt day appends cleaned with onBehalfOf for the debtor', async () => {
    const { storage, emit } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })

    await context.start(async () => {
      const off = model.numberOfDebts.subscribe(() => {})
      // Карина owes one (Леша covered her 2026-06-15 duty). getDebtDays assigns her to
      // the next day Леша is scheduled — 2026-06-16 — so cleaning it repays the debt.
      await emit([
        le({
          ts: 1,
          date: '2026-06-15',
          type: 'went_into_debt',
          actor: 'Леша',
          onBehalfOf: 'Карина',
        }),
      ])
      await vi.waitFor(() => expect(model.numberOfDebts()).toEqual({ Леша: 0, Карина: 1 }))

      await wrap(() => model.confirmClean(D('2026-06-16')))()
      off()
    })

    expect(storage.shared.server.append).toHaveBeenCalledWith(LEDGER_KEY, {
      date: '2026-06-16',
      type: 'cleaned',
      actor: 'Карина',
      onBehalfOf: 'Леша',
      by: 'Леша',
    })
  })

  it('defaults the date to today when no selected date is set', async () => {
    const { storage, emit } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })
    await context.start(async () => {
      const off = model.numberOfDebts.subscribe(() => {})
      await emit([])
      await model.confirmClean()
      off()
    })

    expect(storage.shared.server.append).toHaveBeenCalledWith(
      LEDGER_KEY,
      expect.objectContaining({ date: '2026-06-16' }),
    )
  })
})

describe('ofeliaDutyModel.goIntoDebt', () => {
  it('appends went_into_debt for the scheduled person', async () => {
    const { storage, emit } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })

    await context.start(async () => {
      const off = model.numberOfDebts.subscribe(() => {})
      await emit([])
      await model.goIntoDebt(D('2026-06-16'))
      off()
    })

    expect(storage.shared.server.append).toHaveBeenCalledWith(LEDGER_KEY, {
      date: '2026-06-16',
      type: 'went_into_debt',
      actor: 'Карина',
      onBehalfOf: 'Леша',
      by: 'Леша',
    })
  })
})

describe('ofeliaDutyModel.forgive', () => {
  it('appends forgiven for the current debtor', async () => {
    const { storage, emit } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })

    await context.start(async () => {
      const off = model.numberOfDebts.subscribe(() => {})
      await emit([
        le({
          ts: 1,
          date: '2026-06-14',
          type: 'went_into_debt',
          actor: 'Карина',
          onBehalfOf: 'Леша',
        }),
      ])
      await vi.waitFor(() => expect(model.numberOfDebts()).toEqual({ Леша: 1, Карина: 0 }))

      await wrap(() => model.forgive(D('2026-06-16')))()
      off()
    })

    expect(storage.shared.server.append).toHaveBeenCalledWith(LEDGER_KEY, {
      date: '2026-06-16',
      type: 'forgiven',
      actor: 'Карина',
      onBehalfOf: 'Леша',
      by: 'Леша',
    })
  })

  it('is a no-op when nobody owes', async () => {
    const { storage, emit } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })
    await context.start(async () => {
      const off = model.numberOfDebts.subscribe(() => {})
      await emit([])
      await model.forgive(D('2026-06-16'))
      off()
    })
    expect(storage.shared.server.append).not.toHaveBeenCalled()
  })
})

describe('ofeliaDutyModel.undo', () => {
  it('reopens a closed day (incl. a past day) via a reset entry', async () => {
    const { storage, emit } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })

    await context.start(async () => {
      const off = model.dayResolution.subscribe(() => {})
      await emit([
        le({ ts: 1, date: '2026-06-15', type: 'cleaned', actor: 'Карина', by: 'Карина' }),
      ])
      await vi.waitFor(() => expect(model.dayResolution().get('2026-06-15')?.status).toBe('closed'))

      await wrap(() => model.undo(D('2026-06-15')))()
      off()
    })

    expect(storage.shared.server.append).toHaveBeenCalledWith(LEDGER_KEY, {
      date: '2026-06-15',
      type: 'reset',
      actor: 'Карина',
      by: 'Леша',
    })
  })

  it('is a no-op when the target day is not closed', async () => {
    const { storage } = createLedgerStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })
    await context.start(async () => {
      const off = model.dayResolution.subscribe(() => {})
      await model.undo(D('2026-06-16'))
      off()
    })
    expect(storage.shared.server.append).not.toHaveBeenCalled()
  })
})

describe('legacy key cleanup', () => {
  it('deletes the retired debts and history:* keys on connect', async () => {
    const api = createDexieStorage(instanceNamespace(`ofelia-cleanup-${storageSeq++}`))
    await api.set('debts', { Леша: 3, Карина: 0 })
    await api.set('history:2026-06-15', [{ id: 'x' }])
    const del = vi.fn(api.delete)
    const storage = createStorage({ ...api, delete: del, keys: vi.fn(api.keys) })
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer({ today: D('2026-06-16') }),
    })

    await context.start(async () => {
      const off = model.numberOfDebts.subscribe(() => {})
      await vi.waitFor(() => expect(del).toHaveBeenCalledWith('debts'))
      await vi.waitFor(() => expect(del).toHaveBeenCalledWith('history:2026-06-15'))
      off()
    })
  })
})

describe('ofelia-duty selectors', () => {
  it('otherPerson returns the partner', () => {
    expect(otherPerson('Леша')).toBe('Карина')
    expect(otherPerson('Карина')).toBe('Леша')
  })

  it('weekStartISO uses the Monday of the date week', () => {
    expect(weekStartISO(D('2026-06-16'))).toBe('2026-06-15')
  })

  it('effectiveDuty / isDebtDay reflect projected debt days', () => {
    const debts = { Леша: 0, Карина: 1 }
    const today = D('2026-06-16')
    expect(isDebtDay(D('2026-06-16'), debts, today)).toBe(true)
    expect(effectiveDuty(D('2026-06-16'), debts, today)).toBe('Карина')
    expect(isDebtDay(D('2026-06-17'), {}, today)).toBe(false)
    expect(effectiveDuty(D('2026-06-17'), {}, today)).toBe('Карина')
  })

  it('isOverDebtWarning fires strictly above the threshold', () => {
    expect(DEBT_WARNING_THRESHOLD).toBe(7)
    expect(isOverDebtWarning({ Леша: 7 }, 'Леша')).toBe(false)
    expect(isOverDebtWarning({ Леша: 8 }, 'Леша')).toBe(true)
  })

  it('IP_TAIL_LENGTH is 5', () => {
    expect(IP_TAIL_LENGTH).toBe(5)
  })
})
