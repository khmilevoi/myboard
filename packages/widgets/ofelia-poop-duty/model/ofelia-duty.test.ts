import { context, wrap } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  makeStaticWidgetIdentity,
  StorageError,
  WidgetApiError,
  type StorageApi,
  type WidgetStorage,
} from 'widget-runtime'
import { createFakeTimer } from 'widget-runtime/timer/fakes'

import type { LedgerEntry } from '@/domain/ledger'

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

describe('ofeliaDutyModel action status (F6a)', () => {
  it('surfaces a failed day action instead of discarding it silently', async () => {
    // `invoke` resolves to the error VALUE — the real production shape
    // (WidgetApi never throws); `invokeDay` is the one that re-throws it so
    // `withAsyncData` captures the rejection.
    const invoke = vi.fn(async () => new WidgetApiError({ reason: 'offline', code: 'network' }))
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: D('2026-06-16') }),
      api: { invoke } as never,
      identity: makeStaticWidgetIdentity(),
    })

    expect(model.actionPending()).toBe(false)
    expect(model.actionError()).toBeNull()

    // Before this fix nothing anywhere read `confirmClean.error()` — the
    // widget just fired the action floating and moved on. The failure is
    // expected here; only the surfaced state matters.
    await wrap(async () => {
      await model.confirmClean(D('2026-06-16')).catch(() => undefined)
    })()

    expect(model.actionPending()).toBe(false)
    expect(model.actionError()?.message).toContain('offline')
  })

  it('clears the surfaced error once a later action succeeds', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(new WidgetApiError({ reason: 'offline', code: 'network' }))
      .mockResolvedValueOnce({ ok: true })
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: D('2026-06-16') }),
      api: { invoke } as never,
      identity: makeStaticWidgetIdentity(),
    })

    await wrap(async () => {
      await model.confirmClean(D('2026-06-16')).catch(() => undefined)
    })()
    expect(model.actionError()).not.toBeNull()

    await wrap(() => model.confirmClean(D('2026-06-17')))()
    expect(model.actionError()).toBeNull()
  })

  // MEDIUM: the old `confirmClean.error() ?? goIntoDebt.error() ?? …` chain
  // pinned to whichever of the four failed FIRST, regardless of what
  // succeeded afterward — this is the case the previous test's "retry the
  // SAME action" shape could not catch. A different action succeeding must
  // clear the stale error too.
  it('clears a failed action error when a DIFFERENT action later succeeds', async () => {
    const invoke = vi
      .fn()
      .mockResolvedValueOnce(new WidgetApiError({ reason: 'offline', code: 'network' }))
      .mockResolvedValueOnce({ ok: true })
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: D('2026-06-16') }),
      api: { invoke } as never,
      identity: makeStaticWidgetIdentity(),
    })

    await wrap(async () => {
      await model.confirmClean(D('2026-06-16')).catch(() => undefined)
    })()
    expect(model.actionError()).not.toBeNull()

    await wrap(() => model.goIntoDebt(D('2026-06-17')))()
    expect(model.actionError()).toBeNull()
  })

  it('maps a real WidgetApiError to a Russian, user-facing message', async () => {
    const invoke = vi.fn(async () => new WidgetApiError({ reason: 'offline', code: 'network' }))
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: D('2026-06-16') }),
      api: { invoke } as never,
      identity: makeStaticWidgetIdentity(),
    })

    expect(model.actionErrorMessage()).toBeNull()

    await wrap(async () => {
      await model.confirmClean(D('2026-06-16')).catch(() => undefined)
    })()

    // Never the internal `WidgetApiError.message` ("Widget API request
    // failed: offline") — that string must never reach a household user.
    expect(model.actionErrorMessage()).toBe('Нет соединения с сервером')
  })

  it('falls back to the generic Russian message for an unrecognised error code', async () => {
    const invoke = vi.fn(
      async () => new WidgetApiError({ reason: 'boom', code: 'something_unexpected' }),
    )
    const model = ofeliaDutyModel({
      storage: createStorage(),
      timer: createFakeTimer({ today: D('2026-06-16') }),
      api: { invoke } as never,
      identity: makeStaticWidgetIdentity(),
    })

    await wrap(async () => {
      await model.confirmClean(D('2026-06-16')).catch(() => undefined)
    })()

    expect(model.actionErrorMessage()).toBe('Не удалось выполнить действие')
  })
})

describe('ofeliaDutyModel.retryLedger (F2c)', () => {
  it('re-fetches the ledger through the same public API and clears a previous failure', async () => {
    // `Mock<F>` can't preserve a generic call signature (Parameters/ReturnType
    // erase `T` to `unknown`), so a vi.fn() can never satisfy StorageApi['get']
    // structurally. Assert the concrete instantiation this test actually drives
    // (get('ledger', LedgerEntriesSchema) -> LedgerEntry[]) instead of `any`.
    const get = vi.fn(async () => [] as LedgerEntry[]) as unknown as StorageApi['get']
    const model = ofeliaDutyModel({
      storage: createStorage({ get }),
      timer: createFakeTimer({ today: D('2026-06-16') }),
      api: { invoke: vi.fn(async () => ({ ok: true })) } as never,
      identity: makeStaticWidgetIdentity(),
    })
    model.ledgerError.set(new StorageError({ reason: 'boom' }))

    await wrap(() => model.retryLedger())()

    expect(get).toHaveBeenCalledWith('ledger', expect.anything())
    expect(model.ledgerError()).toBeNull()
    expect(model.ledgerLoading()).toBe(false)
  })

  it('records a failed retry rather than silently leaving the widget stuck', async () => {
    const failure = new StorageError({ reason: 'still down' })
    const get = vi.fn(async () => failure)
    const model = ofeliaDutyModel({
      storage: createStorage({ get }),
      timer: createFakeTimer({ today: D('2026-06-16') }),
      api: { invoke: vi.fn(async () => ({ ok: true })) } as never,
      identity: makeStaticWidgetIdentity(),
    })

    await wrap(() => model.retryLedger())()

    expect(model.ledgerError()).toBe(failure)
    expect(model.ledgerLoading()).toBe(false)
  })
})
