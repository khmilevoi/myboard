import { context, wrap } from '@reatom/core'
import type { LedgerEntry } from 'module-ofelia/domain/ledger'
import { makeTestOfeliaModel, type MakeTestOfeliaModelOptions } from 'module-ofelia/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ModuleApiError, StorageError, type StorageApi } from 'widget-runtime'

import { ofeliaDutyModel } from './ofelia-duty'

// The ledger reactive flows (subscribe -> derived projections -> append actions)
// are covered by the module's own model tests and the Playwright e2e suite.
// What remains here is the widget's own share: view state, action status, and
// the pass-through of the module's atoms.

function createStorage(overrides: Partial<StorageApi> = {}): StorageApi {
  return {
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    keys: vi.fn(async () => []),
    append: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => {}),
    ...overrides,
  }
}

function makeDuty(options: MakeTestOfeliaModelOptions = {}) {
  const test = makeTestOfeliaModel(options)
  return { ...test, duty: ofeliaDutyModel({ ofelia: test.model }) }
}

const D = (iso: string) => Temporal.PlainDate.from(iso)

const EMPTY_LEDGER: LedgerEntry[] = []

afterEach(() => {
  context.reset()
})

describe('ofeliaDutyModel server time', () => {
  it('returns null projections and sends nothing before the first sync', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const { duty: model } = makeDuty({ storage: createStorage(), invoke })

    expect(model.viewWeekStart()).toBeNull()
    expect(model.currentWeek()).toBeNull()
    expect(model.debtDays()).toBeNull()

    await wrap(() => model.goIntoDebt())()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('exposes today so the view model can gate future-day controls', () => {
    const { duty: model } = makeDuty({ storage: createStorage(), todayIso: '2026-06-16' })

    expect(model.today()?.toString()).toBe('2026-06-16')
  })

  it('navigates weeks via the override and resets to the current week', () => {
    const { duty: model } = makeDuty({ storage: createStorage(), todayIso: '2026-06-16' })

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
    const { duty: model } = makeDuty({ storage: createStorage(), todayIso: '2026-06-16' })

    expect(model.selectedDate()).toBeNull()

    model.selectedDate.set(Temporal.PlainDate.from('2026-06-15'))
    expect(model.selectedDate()?.toString()).toBe('2026-06-15')
  })

  it('blocks undo before the first sync', () => {
    const { duty: model } = makeDuty({ storage: createStorage() })

    expect(model.undoAvailable()).toBe(false)
  })
})

describe('ofeliaDutyModel over one shared ofelia model', () => {
  // Review focus: two duty cards on one board share the module's ledger but
  // keep their own navigation and selection.
  it('shares numberOfDebts but keeps week navigation and selection per instance', async () => {
    const { model: ofelia } = makeTestOfeliaModel({ entries: EMPTY_LEDGER, todayIso: '2026-06-16' })
    const first = ofeliaDutyModel({ ofelia })
    const second = ofeliaDutyModel({ ofelia })

    await context.start(async () => {
      // Continuations after `await` run outside the started frame; capture
      // frame-bound closures now so later reads hit this context.
      const readFirstDebts = wrap(() => first.numberOfDebts())
      const readSecondDebts = wrap(() => second.numberOfDebts())
      const readFirstWeek = wrap(() => first.viewWeekStart()?.toString())
      const readSecondWeek = wrap(() => second.viewWeekStart()?.toString())
      const readFirstSelected = wrap(() => first.selectedDate()?.toString())
      const readSecondSelected = wrap(() => second.selectedDate())
      const nextWeekOnFirst = wrap(() => first.goToNextWeek())
      const selectOnFirst = wrap((date: Temporal.PlainDate) => first.selectedDate.set(date))
      const offFirst = first.numberOfDebts.subscribe(() => {})
      const offSecond = second.numberOfDebts.subscribe(() => {})
      const offWeeks = [
        first.viewWeekStart.subscribe(() => {}),
        second.viewWeekStart.subscribe(() => {}),
      ]

      await vi.waitFor(() => expect(readFirstDebts()).not.toBeNull())
      expect(readSecondDebts()).toBe(readFirstDebts())
      expect(first.numberOfDebts).toBe(second.numberOfDebts)

      nextWeekOnFirst()
      expect(readFirstWeek()).toBe('2026-06-22')
      expect(readSecondWeek()).toBe('2026-06-15')

      selectOnFirst(D('2026-06-23'))
      expect(readFirstSelected()).toBe('2026-06-23')
      expect(readSecondSelected()).toBeNull()

      offFirst()
      offSecond()
      for (const off of offWeeks) off()
    })
  })
})

describe('ofeliaDutyModel actions', () => {
  it('invokes the clean event with the target date', async () => {
    const { duty: model, calls } = makeDuty({ todayIso: '2026-06-16' })

    await wrap(() => model.confirmClean(D('2026-06-18')))()

    expect(calls).toEqual([{ action: 'clean', payload: { date: '2026-06-18' } }])
  })

  it('does not write through storage any more', async () => {
    const storage = createStorage()
    const { duty: model } = makeDuty({ storage, todayIso: '2026-06-16' })

    await wrap(() => model.confirmClean(D('2026-06-16')))()

    expect(storage.append).not.toHaveBeenCalled()
  })

  it('maps the remaining day actions onto their own events', async () => {
    const invoke = vi.fn(async () => ({ ok: true }))
    const { duty: model } = makeDuty({ storage: createStorage(), todayIso: '2026-06-16', invoke })

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
    const { duty: model } = makeDuty({ storage: createStorage(), todayIso: '2026-06-16', invoke })

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
  const offline = () => new ModuleApiError({ reason: 'offline', code: 'network' })

  it('surfaces a failed day action instead of discarding it silently', async () => {
    // `invoke` resolves to the error VALUE — the real production shape (the
    // module API never throws); the widget's day action re-throws it so
    // `withAsyncData` captures the rejection.
    const invoke = vi.fn(async () => offline())
    const { duty: model } = makeDuty({ storage: createStorage(), todayIso: '2026-06-16', invoke })

    expect(model.actionPending()).toBe(false)
    expect(model.actionError()).toBeNull()

    await wrap(async () => {
      await model.confirmClean(D('2026-06-16')).catch(() => undefined)
    })()

    expect(model.actionPending()).toBe(false)
    expect(model.actionError()?.message).toContain('offline')
  })

  it('clears the surfaced error once a later action succeeds', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(offline()).mockResolvedValueOnce({ ok: true })
    const { duty: model } = makeDuty({ storage: createStorage(), todayIso: '2026-06-16', invoke })

    await wrap(async () => {
      await model.confirmClean(D('2026-06-16')).catch(() => undefined)
    })()
    expect(model.actionError()).not.toBeNull()

    await wrap(() => model.confirmClean(D('2026-06-17')))()
    expect(model.actionError()).toBeNull()
  })

  // MEDIUM: the old `confirmClean.error() ?? goIntoDebt.error() ?? …` chain
  // pinned to whichever of the four failed FIRST, regardless of what
  // succeeded afterward. A different action succeeding must clear the stale
  // error too.
  it('clears a failed action error when a DIFFERENT action later succeeds', async () => {
    const invoke = vi.fn().mockResolvedValueOnce(offline()).mockResolvedValueOnce({ ok: true })
    const { duty: model } = makeDuty({ storage: createStorage(), todayIso: '2026-06-16', invoke })

    await wrap(async () => {
      await model.confirmClean(D('2026-06-16')).catch(() => undefined)
    })()
    expect(model.actionError()).not.toBeNull()

    await wrap(() => model.goIntoDebt(D('2026-06-17')))()
    expect(model.actionError()).toBeNull()
  })

  it('maps a real ModuleApiError to a Russian, user-facing message', async () => {
    const invoke = vi.fn(async () => offline())
    const { duty: model } = makeDuty({ storage: createStorage(), todayIso: '2026-06-16', invoke })

    expect(model.actionErrorMessage()).toBeNull()

    await wrap(async () => {
      await model.confirmClean(D('2026-06-16')).catch(() => undefined)
    })()

    // Never the internal `ModuleApiError.message` ("Module API request
    // failed: offline") — that string must never reach a household user.
    expect(model.actionErrorMessage()).toBe('Нет соединения с сервером')
  })

  it.each([
    ['unknown_module', 'Модуль недоступен на сервере'],
    ['unknown_action', 'Это действие недоступно на сервере'],
    ['account_required', 'Нужно войти в аккаунт'],
    ['unknown_widget', 'Виджет недоступен на сервере'],
  ])('maps the %s code to its Russian message', async (code, message) => {
    const invoke = vi.fn(async () => new ModuleApiError({ reason: 'nope', code }))
    const { duty: model } = makeDuty({ storage: createStorage(), todayIso: '2026-06-16', invoke })

    await wrap(async () => {
      await model.confirmClean(D('2026-06-16')).catch(() => undefined)
    })()

    expect(model.actionErrorMessage()).toBe(message)
  })

  it('falls back to the generic Russian message for an unrecognised error code', async () => {
    const invoke = vi.fn(
      async () => new ModuleApiError({ reason: 'boom', code: 'something_unexpected' }),
    )
    const { duty: model } = makeDuty({ storage: createStorage(), todayIso: '2026-06-16', invoke })

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
    const { duty: model } = makeDuty({ storage: createStorage({ get }), todayIso: '2026-06-16' })
    model.ledgerError.set(new StorageError({ reason: 'boom' }))

    await wrap(() => model.retryLedger())()

    expect(get).toHaveBeenCalledWith('duty/ledger', expect.anything())
    expect(model.ledgerError()).toBeNull()
    expect(model.ledgerLoading()).toBe(false)
  })

  it('records a failed retry rather than silently leaving the widget stuck', async () => {
    const failure = new StorageError({ reason: 'still down' })
    const get = vi.fn(async () => failure)
    const { duty: model } = makeDuty({ storage: createStorage({ get }), todayIso: '2026-06-16' })

    await wrap(() => model.retryLedger())()

    expect(model.ledgerError()).toBe(failure)
    expect(model.ledgerLoading()).toBe(false)
  })
})
