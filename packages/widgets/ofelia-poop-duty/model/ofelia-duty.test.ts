import { context, wrap } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeStaticWidgetIdentity, type StorageApi, type WidgetStorage } from 'widget-runtime'
import { createFakeTimer } from 'widget-runtime/timer/fakes'

import { ofeliaDutyModel } from './ofelia-duty'

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
  it('returns null projections and sends nothing before the first sync', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer(),
      api: { invoke } as never,
      identity: makeStaticWidgetIdentity(),
    })

    expect(model.viewWeekStart()).toBeNull()
    expect(model.currentWeek()).toBeNull()
    expect(model.debtDays()).toBeNull()

    await wrap(() => model.goIntoDebt())()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('exposes today so the view model can gate future-day controls', () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: Temporal.PlainDate.from('2026-06-16') }),
      api: { invoke: vi.fn(async () => ({ ok: true })) } as never,
      identity: makeStaticWidgetIdentity(),
    })

    expect(model.today()?.toString()).toBe('2026-06-16')
  })

  it('navigates weeks via the override and resets to the current week', () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: D('2026-06-16') }),
      api: { invoke: vi.fn(async () => ({ ok: true })) } as never,
      identity: makeStaticWidgetIdentity(),
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
      api: { invoke: vi.fn(async () => ({ ok: true })) } as never,
      identity: makeStaticWidgetIdentity(),
    })

    expect(model.selectedDate()).toBeNull()

    model.selectedDate.set(Temporal.PlainDate.from('2026-06-15'))
    expect(model.selectedDate()?.toString()).toBe('2026-06-15')
  })

  it('blocks undo before the first sync', () => {
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer(),
      api: { invoke: vi.fn(async () => ({ ok: true })) } as never,
      identity: makeStaticWidgetIdentity(),
    })

    expect(model.undoAvailable()).toBe(false)
  })
})

describe('ofeliaDutyModel actions', () => {
  it('invokes the clean event with the target date', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: D('2026-06-16') }),
      api: { invoke } as never,
      identity: makeStaticWidgetIdentity(),
    })

    await wrap(() => model.confirmClean(D('2026-06-18')))()

    expect(invoke).toHaveBeenCalledWith('clean', { date: '2026-06-18' })
  })

  it('does not write through storage any more', async () => {
    const storage = createStorage()
    const model = ofeliaDutyModel({
      storage,
      timer: createFakeTimer({ today: D('2026-06-16') }),
      api: { invoke: vi.fn(async () => ({ ok: true })) } as never,
      identity: makeStaticWidgetIdentity(),
    })

    await wrap(() => model.confirmClean(D('2026-06-16')))()

    expect(storage.shared.server.append).not.toHaveBeenCalled()
  })

  it('maps the remaining day actions onto their own events', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: D('2026-06-16') }),
      api: { invoke } as never,
      identity: makeStaticWidgetIdentity(),
    })

    await wrap(() => model.goIntoDebt(D('2026-06-16')))()
    await wrap(() => model.forgive(D('2026-06-17')))()
    await wrap(() => model.undo(D('2026-06-18')))()

    expect(invoke.mock.calls).toEqual([
      ['debt', { date: '2026-06-16' }],
      ['forgive', { date: '2026-06-17' }],
      ['undo', { date: '2026-06-18' }],
    ])
  })

  it('falls back to the selected day, then today', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: D('2026-06-16') }),
      api: { invoke } as never,
      identity: makeStaticWidgetIdentity(),
    })

    await wrap(() => model.confirmClean())()
    model.selectedDate.set(D('2026-06-19'))
    await wrap(() => model.confirmClean())()

    expect(invoke.mock.calls).toEqual([
      ['clean', { date: '2026-06-16' }],
      ['clean', { date: '2026-06-19' }],
    ])
  })
})
