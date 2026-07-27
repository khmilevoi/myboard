// @vitest-environment node

import type {
  WidgetCronContext,
  WidgetServerContext,
  WidgetServerStorage,
} from '@shared/widgets/contracts'
import { describe, expect, it, vi } from 'vitest'

import { LEDGER_KEY } from './domain/ledger'
import ofeliaServer from './server'

const KARINA = { accountId: 'a1', name: 'Карина' }
// 2026-06-16 12:00 Europe/Warsaw
const NOW = Date.UTC(2026, 5, 16, 10, 0, 0)

function makeContext(stored: unknown = null, viewer = KARINA) {
  const append = vi.fn<WidgetServerStorage['append']>(async () => undefined)
  const shared: WidgetServerStorage = {
    get: vi.fn(async () => stored as never),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    keys: vi.fn(async () => []),
    append,
  }

  const context = {
    typeId: 'ofelia-poop-duty',
    instanceId: 'i1',
    ip: null,
    viewer,
    now: () => NOW,
    api: { storage: { instance: shared, shared }, browser: {} as never },
  } as unknown as WidgetServerContext

  return { context, append }
}

const run = (
  event: keyof typeof ofeliaServer.handlers,
  payload: unknown,
  context: WidgetServerContext,
) =>
  ofeliaServer.handlers[event](ofeliaServer.schemas[event].payload.parse(payload) as never, context)

describe('ofelia server', () => {
  it('appends a cleaned entry stamped with the viewer', async () => {
    const { context, append } = makeContext([])

    expect(await run('clean', { date: '2026-06-16' }, context)).toEqual({ ok: true })
    expect(append).toHaveBeenCalledWith(LEDGER_KEY, {
      date: '2026-06-16',
      type: 'cleaned',
      actor: 'Леша',
      createdBy: KARINA,
      by: 'Леша',
    })
  })

  it('stamps null when there is no session', async () => {
    const { context, append } = makeContext([], null as never)

    await run('clean', { date: '2026-06-16' }, context)

    expect(append.mock.calls[0][1]).toMatchObject({ createdBy: null })
  })

  it('half 1: the clean payload schema strips a forged createdBy/actor before parsing', () => {
    const parsed = ofeliaServer.schemas.clean.payload.parse({
      date: '2026-06-16',
      createdBy: { accountId: 'evil', name: 'Мимо' },
      actor: 'Карина',
    })

    expect(parsed).toEqual({ date: '2026-06-16' })
  })

  it('half 1: the comment payload schema strips a forged createdBy before parsing', () => {
    const parsed = ofeliaServer.schemas.comment.payload.parse({
      weekStart: '2026-06-15',
      text: 'привет',
      createdBy: { accountId: 'evil', name: 'Мимо' },
    })

    expect(parsed).toEqual({ weekStart: '2026-06-15', text: 'привет' })
  })

  it('half 2: the clean handler ignores createdBy/actor even when a caller bypasses the schema', async () => {
    const { context, append } = makeContext([])
    // Deliberately skips run()/payload.parse() — hands the handler a payload
    // that still carries createdBy/actor, as if the schema had already let
    // them through, to prove the handler itself never reads them.
    const forgedPayload = {
      date: '2026-06-16',
      createdBy: { accountId: 'evil', name: 'Мимо' },
      actor: 'Карина',
    } as unknown as Parameters<(typeof ofeliaServer.handlers)['clean']>[0]

    expect(await ofeliaServer.handlers.clean(forgedPayload, context)).toEqual({ ok: true })
    expect(append).toHaveBeenCalledWith(LEDGER_KEY, {
      date: '2026-06-16',
      type: 'cleaned',
      actor: 'Леша',
      createdBy: KARINA,
      by: 'Леша',
    })
  })

  it('appends a debt entry stamped with the viewer', async () => {
    const { context, append } = makeContext([])

    expect(await run('debt', { date: '2026-06-16' }, context)).toEqual({ ok: true })
    expect(append).toHaveBeenCalledWith(LEDGER_KEY, {
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

    expect(await run('forgive', { date: '2026-06-16' }, context)).toEqual({ ok: true })
    expect(append).not.toHaveBeenCalled()
  })

  it('is a silent no-op when undoing an open day', async () => {
    const { context, append } = makeContext([])

    expect(await run('undo', { date: '2026-06-16' }, context)).toEqual({ ok: true })
    expect(append).not.toHaveBeenCalled()
  })

  it('appends a comment under the viewed week key', async () => {
    const { context, append } = makeContext([])

    await run('comment', { weekStart: '2026-06-15', text: '  привет ' }, context)

    expect(append).toHaveBeenCalledWith('comments:2026-06-15', {
      text: 'привет',
      createdBy: KARINA,
      author: 'Карина',
    })
  })

  it('rejects a calendar-invalid date as a value instead of throwing', async () => {
    const { context, append } = makeContext([])

    expect(await run('clean', { date: '2026-02-30' }, context)).toBeInstanceOf(Error)
    expect(append).not.toHaveBeenCalled()
  })

  it('surfaces a storage read failure without writing', async () => {
    const failure = new Error('valkey down')
    const { context, append } = makeContext(failure)

    expect(await run('clean', { date: '2026-06-16' }, context)).toBe(failure)
    expect(append).not.toHaveBeenCalled()
  })
})

function makeCronContext(
  stored: unknown = null,
  scheduledFor = Date.parse('2026-06-17T00:05:00+02:00'),
) {
  const append = vi.fn<WidgetServerStorage['append']>(async () => undefined)
  const shared = {
    get: vi.fn(async () => stored as never),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    has: vi.fn(async () => false),
    keys: vi.fn(async () => []),
    append,
  } as unknown as WidgetServerStorage

  const context = {
    typeId: 'ofelia-poop-duty',
    now: () => scheduledFor,
    scheduledFor,
    api: { storage: { shared }, browser: {} as never },
  } as unknown as WidgetCronContext

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

describe('ofelia auto-approve cron', () => {
  it('closes the unresolved window with system-authored entries', async () => {
    const { context, append } = makeCronContext([SEED_ENTRY])

    expect(await ofeliaServer.crons?.autoApproveDay.run(context)).toBeUndefined()
    expect(append).toHaveBeenCalledTimes(7)
    expect(append).toHaveBeenLastCalledWith(LEDGER_KEY, {
      date: '2026-06-16',
      type: 'cleaned',
      actor: 'Леша',
      createdBy: { system: true },
      by: 'Леша',
    })
  })

  it('returns the storage error instead of throwing', async () => {
    const { context, append } = makeCronContext(null)
    context.api.storage.shared.get = vi.fn(async () => new Error('valkey down') as never)

    expect(await ofeliaServer.crons?.autoApproveDay.run(context)).toBeInstanceOf(Error)
    expect(append).not.toHaveBeenCalled()
  })

  it('is a no-op, with no append, when the ledger key does not exist (F11)', async () => {
    // Every stack ships this widget's server.ts, so its cron is registered
    // everywhere regardless of whether the widget was ever placed on a
    // board. A missing ledger key means nobody has ever used it — nothing
    // to auto-approve, and the job must not fabricate history by writing.
    const { context, append } = makeCronContext(null)

    expect(await ofeliaServer.crons?.autoApproveDay.run(context)).toBeUndefined()
    expect(append).not.toHaveBeenCalled()
  })

  it('is a no-op, with no append, when the ledger key resolves to an empty array (F11)', async () => {
    const { context, append } = makeCronContext([])

    expect(await ofeliaServer.crons?.autoApproveDay.run(context)).toBeUndefined()
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
    context.api.storage.shared.get = vi.fn(async () => {
      calls += 1
      return (calls >= 5 ? [SEED_ENTRY, manualClose] : [SEED_ENTRY]) as never
    })

    expect(await ofeliaServer.crons?.autoApproveDay.run(context)).toBeUndefined()

    // 06-10, 06-11, 06-12, 06-14, 06-15, 06-16 still get the system close;
    // 06-13 does not, because the manual close already resolved it by the
    // time this job re-checked that specific day.
    expect(append).toHaveBeenCalledTimes(6)
    expect(append).not.toHaveBeenCalledWith(
      LEDGER_KEY,
      expect.objectContaining({ date: '2026-06-13' }),
    )
  })
})
