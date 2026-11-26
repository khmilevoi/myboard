// @vitest-environment node

import type { ModuleCronContext, ModuleServerContext } from '@shared/modules/contracts'
import type { WidgetServerStorage } from '@shared/widgets/contracts'
import { describe, expect, it, vi } from 'vitest'

import { catsActionSchemas } from './domain/actions'
import { OFELIA_ID } from './domain/ids'
import { ledgerKey, litterSettingsKey } from './domain/keys'
import type { LitterSettings } from './domain/roster'
import catsServer from './server'

const KARINA = { accountId: 'a1', name: 'Карина' }
// 2026-06-16 12:00 Europe/Warsaw
const NOW = Date.UTC(2026, 5, 16, 10, 0, 0)

const SWAPPED: LitterSettings = { rotation: ['Карина', 'Леша'], baseDate: '2026-06-16' }

/** A storage `get` that answers Ofelia's settings key with `settings` and every other key with `stored`. */
const answerGet = (stored: unknown, settings: unknown) =>
  vi.fn(async (key: string) => (key === litterSettingsKey(OFELIA_ID) ? settings : stored) as never)

function makeContext(stored: unknown = null, viewer = KARINA, settings: unknown = null) {
  const append = vi.fn<WidgetServerStorage['append']>(async () => undefined)
  const shared: WidgetServerStorage = {
    get: answerGet(stored, settings) as WidgetServerStorage['get'],
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    keys: vi.fn(async () => []),
    append,
  }

  const context = {
    moduleId: 'cats',
    viewer,
    now: () => NOW,
    api: { storage: { shared } },
  } as unknown as ModuleServerContext<'shared'>

  return { context, append }
}

const run = (
  event: keyof typeof catsServer.handlers,
  payload: unknown,
  context: ModuleServerContext<'shared'>,
) =>
  catsServer.handlers[event](
    catsServer.contract.actions[event].payload.parse(payload) as never,
    context,
  )

describe('cats server', () => {
  it('appends a cleaned entry stamped with the viewer', async () => {
    const { context, append } = makeContext([])

    expect(await run('clean', { litterId: OFELIA_ID, date: '2026-06-16' }, context)).toEqual({
      ok: true,
    })
    expect(append).toHaveBeenCalledWith(ledgerKey(OFELIA_ID), {
      date: '2026-06-16',
      type: 'cleaned',
      actor: 'Леша',
      createdBy: KARINA,
      by: 'Леша',
    })
  })

  it("reads the duty from the litter's stored settings", async () => {
    const { context, append } = makeContext([], KARINA, SWAPPED)

    await run('clean', { litterId: OFELIA_ID, date: '2026-06-16' }, context)

    expect(append).toHaveBeenCalledWith(
      ledgerKey(OFELIA_ID),
      expect.objectContaining({ type: 'cleaned', actor: 'Карина' }),
    )
  })

  it('falls back to the default rotation when the stored settings do not parse', async () => {
    const { context, append } = makeContext([], KARINA, { rotation: 'junk' })

    expect(await run('clean', { litterId: OFELIA_ID, date: '2026-06-16' }, context)).toEqual({
      ok: true,
    })
    expect(append).toHaveBeenCalledWith(
      ledgerKey(OFELIA_ID),
      expect.objectContaining({ type: 'cleaned', actor: 'Леша' }),
    )
  })

  it('stamps null when there is no session', async () => {
    const { context, append } = makeContext([], null as never)

    await run('clean', { litterId: OFELIA_ID, date: '2026-06-16' }, context)

    expect(append.mock.calls[0][1]).toMatchObject({ createdBy: null })
  })

  it('half 1: the clean payload schema strips a forged createdBy/actor before parsing', () => {
    const parsed = catsServer.contract.actions.clean.payload.parse({
      litterId: OFELIA_ID,
      date: '2026-06-16',
      createdBy: { accountId: 'evil', name: 'Мимо' },
      actor: 'Карина',
    })

    expect(parsed).toEqual({ litterId: OFELIA_ID, date: '2026-06-16' })
  })

  it('half 1: the comment payload schema strips a forged createdBy before parsing', () => {
    const parsed = catsServer.contract.actions.comment.payload.parse({
      litterId: OFELIA_ID,
      weekStart: '2026-06-15',
      text: 'привет',
      createdBy: { accountId: 'evil', name: 'Мимо' },
    })

    expect(parsed).toEqual({ litterId: OFELIA_ID, weekStart: '2026-06-15', text: 'привет' })
  })

  it('half 2: the clean handler ignores createdBy/actor even when a caller bypasses the schema', async () => {
    const { context, append } = makeContext([])
    // Deliberately skips run()/payload.parse() — hands the handler a payload
    // that still carries createdBy/actor, as if the schema had already let
    // them through, to prove the handler itself never reads them.
    const forgedPayload = {
      litterId: OFELIA_ID,
      date: '2026-06-16',
      createdBy: { accountId: 'evil', name: 'Мимо' },
      actor: 'Карина',
    } as unknown as Parameters<(typeof catsServer.handlers)['clean']>[0]

    expect(await catsServer.handlers.clean(forgedPayload, context)).toEqual({ ok: true })
    expect(append).toHaveBeenCalledWith(ledgerKey(OFELIA_ID), {
      date: '2026-06-16',
      type: 'cleaned',
      actor: 'Леша',
      createdBy: KARINA,
      by: 'Леша',
    })
  })

  it('appends a debt entry stamped with the viewer', async () => {
    const { context, append } = makeContext([])

    expect(await run('debt', { litterId: OFELIA_ID, date: '2026-06-16' }, context)).toEqual({
      ok: true,
    })
    expect(append).toHaveBeenCalledWith(ledgerKey(OFELIA_ID), {
      date: '2026-06-16',
      type: 'went_into_debt',
      actor: 'Карина',
      onBehalfOf: 'Леша',
      createdBy: KARINA,
      by: 'Карина',
    })
  })

  it('is a silent no-op when forgiving a day that carries no debt', async () => {
    const { context, append } = makeContext([])

    expect(await run('forgive', { litterId: OFELIA_ID, date: '2026-06-16' }, context)).toEqual({
      ok: true,
    })
    expect(append).not.toHaveBeenCalled()
  })

  it('is a silent no-op when undoing an open day', async () => {
    const { context, append } = makeContext([])

    expect(await run('undo', { litterId: OFELIA_ID, date: '2026-06-16' }, context)).toEqual({
      ok: true,
    })
    expect(append).not.toHaveBeenCalled()
  })

  it('appends a comment under the viewed week key', async () => {
    const { context, append } = makeContext([])

    await run(
      'comment',
      { litterId: OFELIA_ID, weekStart: '2026-06-15', text: '  привет ' },
      context,
    )

    expect(append).toHaveBeenCalledWith('litter/ofelia/comments:2026-06-15', {
      text: 'привет',
      createdBy: KARINA,
      author: 'Карина',
    })
  })

  it("appends a day action to the payload litter's own ledger", async () => {
    const { context, append } = makeContext([])

    expect(await run('clean', { litterId: 'busya', date: '2026-06-16' }, context)).toEqual({
      ok: true,
    })
    expect(context.api.storage.shared.get).toHaveBeenCalledWith(
      'litter/busya/ledger',
      expect.anything(),
    )
    expect(append).toHaveBeenCalledWith('litter/busya/ledger', expect.anything())
  })

  it("appends a comment under the payload litter's week key", async () => {
    const { context, append } = makeContext([])

    await run('comment', { litterId: 'busya', weekStart: '2026-06-15', text: 'привет' }, context)

    expect(append).toHaveBeenCalledWith('litter/busya/comments:2026-06-15', expect.anything())
  })

  it('rejects a litter id that is not a key-safe entity id', () => {
    expect(
      catsActionSchemas.clean.payload.safeParse({ litterId: 'a/b', date: '2026-06-16' }).success,
    ).toBe(false)
  })

  it('rejects a calendar-invalid date as a value instead of throwing', async () => {
    const { context, append } = makeContext([])

    expect(await run('clean', { litterId: OFELIA_ID, date: '2026-02-30' }, context)).toBeInstanceOf(
      Error,
    )
    expect(append).not.toHaveBeenCalled()
  })

  it('surfaces a storage read failure without writing', async () => {
    const failure = new Error('valkey down')
    const { context, append } = makeContext(failure)

    expect(await run('clean', { litterId: OFELIA_ID, date: '2026-06-16' }, context)).toBe(failure)
    expect(append).not.toHaveBeenCalled()
  })
})

function makeCronContext(
  stored: unknown = null,
  scheduledFor = Date.parse('2026-06-17T00:05:00+02:00'),
  settings: unknown = null,
) {
  const append = vi.fn<WidgetServerStorage['append']>(async () => undefined)
  const shared = {
    get: answerGet(stored, settings),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    keys: vi.fn(async () => []),
    append,
  } as unknown as WidgetServerStorage

  const context = {
    moduleId: 'cats',
    now: () => scheduledFor,
    scheduledFor,
    api: { storage: { shared } },
  } as unknown as ModuleCronContext

  return { context, append }
}

// A seed record dated well before the auto-approve window, only to keep the
// ledger non-empty in tests that exercise a widget that has already been
// used at least once (a genuinely empty/absent ledger is covered by the
// F11 no-op test below, and must not reach these assertions).
const SEED_ENTRY = {
  id: 'seed',
  ts: 0,
  date: '2026-01-01',
  type: 'cleaned' as const,
  actor: 'Леша' as const,
  createdBy: null,
}

describe('cats auto-approve cron', () => {
  it('closes the unresolved window with system-authored entries', async () => {
    const { context, append } = makeCronContext([SEED_ENTRY])

    expect(await catsServer.crons?.autoApproveDay.run(context)).toBeUndefined()
    expect(append).toHaveBeenCalledTimes(7)
    expect(append).toHaveBeenLastCalledWith(ledgerKey(OFELIA_ID), {
      date: '2026-06-16',
      type: 'cleaned',
      actor: 'Леша',
      createdBy: { system: true },
      by: 'Леша',
    })
  })

  it("closes the window by the litter's stored rotation", async () => {
    const { context, append } = makeCronContext([SEED_ENTRY], undefined, SWAPPED)

    expect(await catsServer.crons?.autoApproveDay.run(context)).toBeUndefined()
    expect(append).toHaveBeenLastCalledWith(
      ledgerKey(OFELIA_ID),
      expect.objectContaining({ date: '2026-06-16', actor: 'Карина' }),
    )
  })

  it('still closes the window, by the default rotation, when the stored settings do not parse', async () => {
    const { context, append } = makeCronContext([SEED_ENTRY], undefined, { rotation: 'junk' })

    expect(await catsServer.crons?.autoApproveDay.run(context)).toBeUndefined()
    expect(append).toHaveBeenCalledTimes(7)
    expect(append).toHaveBeenLastCalledWith(
      ledgerKey(OFELIA_ID),
      expect.objectContaining({ date: '2026-06-16', actor: 'Леша' }),
    )
  })

  it('returns the storage error instead of throwing', async () => {
    const { context, append } = makeCronContext(null)
    context.api.storage.shared.get = vi.fn(async () => new Error('valkey down') as never)

    expect(await catsServer.crons?.autoApproveDay.run(context)).toBeInstanceOf(Error)
    expect(append).not.toHaveBeenCalled()
  })

  it('is a no-op, with no append, when the ledger key does not exist (F11)', async () => {
    // Every stack ships this module's server.ts, so its cron is registered
    // everywhere regardless of whether the widget was ever placed on a
    // board. A missing ledger key means nobody has ever used it — nothing
    // to auto-approve, and the job must not fabricate history by writing.
    const { context, append } = makeCronContext(null)

    expect(await catsServer.crons?.autoApproveDay.run(context)).toBeUndefined()
    expect(append).not.toHaveBeenCalled()
  })

  it('is a no-op, with no append, when the ledger key resolves to an empty array (F11)', async () => {
    const { context, append } = makeCronContext([])

    expect(await catsServer.crons?.autoApproveDay.run(context)).toBeUndefined()
    expect(append).not.toHaveBeenCalled()
  })

  it('skips a day that a concurrent manual close resolved after the initial read (F10)', async () => {
    // 06-13 is the 4th day of the 7-day window (06-10 … 06-16). Simulate a
    // widget dispatch that manually closes it in the gap between the job's
    // initial read (call #1) and the fresh re-check this job now does right
    // before appending that day's draft (call #5: initial + 3 prior re-checks
    // for 06-10, 06-11, 06-12).
    const manualClose = {
      id: 'manual-1',
      ts: 999,
      date: '2026-06-13',
      type: 'cleaned' as const,
      actor: 'Карина' as const,
      createdBy: KARINA,
    }

    let calls = 0
    const { context, append } = makeCronContext([SEED_ENTRY])
    context.api.storage.shared.get = vi.fn(async (key: string) => {
      if (key !== ledgerKey(OFELIA_ID)) return null as never
      calls += 1
      return (calls >= 5 ? [SEED_ENTRY, manualClose] : [SEED_ENTRY]) as never
    })

    expect(await catsServer.crons?.autoApproveDay.run(context)).toBeUndefined()

    // 06-10, 06-11, 06-12, 06-14, 06-15, 06-16 still get the system close;
    // 06-13 does not, because the manual close already resolved it by the
    // time this job re-checked that specific day.
    expect(append).toHaveBeenCalledTimes(6)
    expect(append).not.toHaveBeenCalledWith(
      ledgerKey(OFELIA_ID),
      expect.objectContaining({ date: '2026-06-13' }),
    )
  })
})
