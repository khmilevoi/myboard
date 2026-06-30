import { context, wrap } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createFakeTimer } from '@/shared/timer/model/fakes'
import type { WidgetStorage } from '@/storage/model/storage'
import type { StorageApi } from '@/storage/model/types'

import {
  DEBT_WARNING_THRESHOLD,
  effectiveDuty,
  IP_TAIL_LENGTH,
  isDebtDay,
  isOverDebtWarning,
  ofeliaDutyModel,
  otherPerson,
  weekStartISO,
} from './ofelia-duty'
import type { DayResolution } from './ofelia-duty'

// The ledger reactive flows (subscribe -> derived projections -> append actions)
// are covered by the Playwright e2e suite. They are intentionally not unit-tested:
// withStorageKeyReadonly binds its listener to the atom's connect-frame, which the
// real app drives through a single React/SSE context but a Vitest harness cannot
// reproduce without contorting the production model. What remains here are the
// pure-logic and context-free tests.

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

const D = (iso: string) => Temporal.PlainDate.from(iso)

afterEach(() => {
  context.reset()
})

describe('ofeliaDutyModel server time', () => {
  it('returns null projections and blocks actions before the first sync', async () => {
    const storage = createStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer() })

    expect(model.viewWeekStart()).toBeNull()
    expect(model.currentWeek()).toBeNull()
    expect(model.debtDays()).toBeNull()

    await model.goIntoDebt()
    expect(storage.shared.server.append).not.toHaveBeenCalled()
  })

  it('blocks append actions while the ledger has not synced yet', async () => {
    const storage = createStorage()
    const model = ofeliaDutyModel({ storage, timer: createFakeTimer({ today: D('2026-06-16') }) })

    await model.confirmClean(D('2026-06-16'))
    await model.goIntoDebt(D('2026-06-16'))
    await model.forgive(D('2026-06-16'))
    await model.undo(D('2026-06-16'))

    expect(storage.shared.server.append).not.toHaveBeenCalled()
  })

  it('exposes today so the view model can gate future-day controls', () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: Temporal.PlainDate.from('2026-06-16') }),
    })

    expect(model.today()?.toString()).toBe('2026-06-16')
  })

  it('navigates weeks via the override and resets to the current week', () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: D('2026-06-16') }),
    })

    return context.start(async () => {
      const off = model.viewWeekStart.subscribe(() => {})

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

  it('effectiveDuty / isDebtDay skip already closed days when projecting debt', () => {
    const debts = { Леша: 0, Карина: 1 }
    const today = D('2026-06-16')
    const resolution = new Map([
      [
        '2026-06-16',
        {
          status: 'closed',
          type: 'went_into_debt',
          actor: 'Леша',
          onBehalfOf: 'Карина',
        } satisfies DayResolution,
      ],
    ])

    expect(isDebtDay(D('2026-06-16'), debts, today, resolution)).toBe(false)
    expect(isDebtDay(D('2026-06-18'), debts, today, resolution)).toBe(true)
    expect(effectiveDuty(D('2026-06-18'), debts, today, resolution)).toBe('Карина')
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
