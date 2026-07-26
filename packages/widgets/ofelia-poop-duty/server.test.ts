// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import type { WidgetServerContext, WidgetServerStorage } from '@shared/widgets/contracts'

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

const run = (event: keyof typeof ofeliaServer.handlers, payload: unknown, context: WidgetServerContext) =>
  ofeliaServer.handlers[event](ofeliaServer.schemas[event].payload.parse(payload) as never, context)

describe('ofelia server', () => {
  it('appends a cleaned entry stamped with the viewer', async () => {
    const { context, append } = makeContext([])

    expect(await run('clean', { date: '2026-06-16' }, context)).toEqual({ ok: true })
    expect(append).toHaveBeenCalledWith(LEDGER_KEY, {
      date: '2026-06-16', type: 'cleaned', actor: 'Леша', createdBy: KARINA,
    })
  })

  it('stamps null when there is no session', async () => {
    const { context, append } = makeContext([], null as never)

    await run('clean', { date: '2026-06-16' }, context)

    expect(append.mock.calls[0][1]).toMatchObject({ createdBy: null })
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
      text: 'привет', createdBy: KARINA,
    })
  })

  it('surfaces a storage read failure', async () => {
    const { context } = makeContext(new Error('valkey down'))

    expect(await run('clean', { date: '2026-06-16' }, context)).toBeInstanceOf(Error)
  })
})
