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

describe('ofelia auto-approve cron', () => {
  it('closes the unresolved window with system-authored entries', async () => {
    const { context, append } = makeCronContext([])

    expect(await ofeliaServer.crons?.autoApproveDay.run(context)).toBeUndefined()
    expect(append).toHaveBeenCalledTimes(7)
    expect(append).toHaveBeenLastCalledWith(LEDGER_KEY, {
      date: '2026-06-16',
      type: 'cleaned',
      actor: 'Леша',
      createdBy: { system: true },
    })
  })

  it('returns the storage error instead of throwing', async () => {
    const { context, append } = makeCronContext(null)
    context.api.storage.shared.get = vi.fn(async () => new Error('valkey down') as never)

    expect(await ofeliaServer.crons?.autoApproveDay.run(context)).toBeInstanceOf(Error)
    expect(append).not.toHaveBeenCalled()
  })
})
