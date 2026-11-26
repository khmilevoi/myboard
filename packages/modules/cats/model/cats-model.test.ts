import { context, wrap } from '@reatom/core'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFakeStorage } from 'widget-runtime/storage/test/fakes'

import { ledgerKey } from '../domain/keys'
import type { LedgerEntry } from '../domain/ledger'
import { makeTestCatsModel } from './testing'

const D = (iso: string) => Temporal.PlainDate.from(iso)

const ENTRIES: LedgerEntry[] = [
  { id: 'e1', ts: 1, date: '2026-06-15', type: 'cleaned', actor: 'Карина' },
]

afterEach(() => {
  context.reset()
})

describe('makeCatsModel.litter', () => {
  it('memoizes one litter model per id', () => {
    const { model } = makeTestCatsModel()

    expect(model.litter('ofelia')).toBe(model.litter('ofelia'))
    expect(model.litter('a')).not.toBe(model.litter('b'))
  })

  it('reads each litter from its own ledger key', async () => {
    const storage = createFakeStorage()
    // The fake's `set` writes synchronously before its first await, so the key
    // is seeded by the time the litter's connect hook subscribes.
    void storage.set(ledgerKey('a'), ENTRIES)
    const { model } = makeTestCatsModel({ storage })
    const a = model.litter('a')
    const b = model.litter('b')

    await context.start(async () => {
      const offs = [a.ledger.subscribe(() => {}), b.ledger.subscribe(() => {})]
      const read = wrap(() => ({ a: a.ledger(), b: b.ledger() }))

      await vi.waitFor(() => expect(read()).toEqual({ a: ENTRIES, b: [] }))

      for (const off of offs) off()
    })
  })

  it("carries the litter id in a litter's day action payload", async () => {
    const { model, calls } = makeTestCatsModel()

    await wrap(() => model.litter('ofelia').runDayAction('clean', D('2026-06-17')))()

    expect(calls).toEqual([
      { action: 'clean', payload: { litterId: 'ofelia', date: '2026-06-17' } },
    ])
  })
})
